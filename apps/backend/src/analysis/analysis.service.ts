import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AnalysisReason,
  AnalyzeResponse,
  RISK_THRESHOLDS,
  verdictFromScore,
} from '@novashield/shared';
import { BlocklistService } from './layers/blocklist.service';
import { HeuristicsService } from './layers/heuristics.service';
import { LlmService } from './layers/llm.service';
import { WebRiskService } from './layers/webrisk.service';
import { expandUrl, extractUrl, KNOWN_SHORTENERS } from './url-utils';

/**
 * Orquestador del motor de 3 capas (ver anteproyecto §04.2):
 *   Capa 1 · listas de amenazas → veredicto inmediato si hay match.
 *   Capa 2 · Web Risk → verificación autoritativa (si está configurada).
 *   Capa 3 · heurísticas + LLM → señales y contexto para lo que las listas
 *            todavía no conocen.
 * Si cualquiera enciende una alarma, el usuario se entera.
 */

const BLOCKLIST_URL_SCORE = 95;
const BLOCKLIST_DOMAIN_SCORE = 85;
const WEBRISK_SCORE = 90;
/** El LLM solo se consulta cuando el caso es ambiguo: controla costo y latencia. */
const LLM_MIN_SCORE = 10;

@Injectable()
export class AnalysisService {
  constructor(
    private readonly blocklists: BlocklistService,
    private readonly heuristics: HeuristicsService,
    private readonly webRisk: WebRiskService,
    private readonly llm: LlmService,
  ) {}

  /**
   * `deepAnalysis: false` apaga las capas que cuestan plata por consulta (Web
   * Risk y el LLM). Lo manda la app cuando un usuario del plan gratuito superó
   * su tope diario. Las capas 1 y 3a —listas de amenazas y heurísticas— corren
   * SIEMPRE: son locales, no cuestan nada y atajan la mayoría del phishing
   * real. Nadie se queda sin veredicto por no pagar.
   */
  async analyze(
    rawInput: string,
    options: { deepAnalysis?: boolean } = {},
  ): Promise<AnalyzeResponse> {
    const deepAnalysis = options.deepAnalysis !== false;
    const startedAt = Date.now();

    const submitted = extractUrl(rawInput);
    if (!submitted) {
      throw new BadRequestException(
        'No encontramos ningún enlace en el texto. Pegá el link completo (por ejemplo: https://ejemplo.com).',
      );
    }

    // Expansión server-side solo para acortadores conocidos: revela el destino
    // sin pagar la latencia de un fetch en cada análisis.
    const isShortener = KNOWN_SHORTENERS.has(
      submitted.hostname.toLowerCase().replace(/\.$/, ''),
    );
    const { finalUrl, chain } = isShortener
      ? await expandUrl(submitted)
      : { finalUrl: submitted, chain: [] };

    const reasons: AnalysisReason[] = [];
    let score = 0;

    // Capa 1 · listas (URL enviada y URL final)
    const hit =
      this.blocklists.lookup(finalUrl) ?? this.blocklists.lookup(submitted);
    if (hit) {
      score = hit.kind === 'url' ? BLOCKLIST_URL_SCORE : BLOCKLIST_DOMAIN_SCORE;
      reasons.push({
        code: 'BLOCKLIST_HIT',
        layer: 'blocklists',
        severity: 'critical',
        title: 'Reportado como sitio malicioso',
        detail: `Este ${hit.kind === 'url' ? 'enlace' : 'dominio'} figura en bases globales de phishing y malware (fuente: ${hit.source}). No lo abras ni cargues datos ahí.`,
      });
    }

    // Capa 3a · heurísticas (siempre corren: son locales y gratis)
    const heur = this.heuristics.analyze(finalUrl, chain.length > 0);
    reasons.push(...heur.reasons);
    score = Math.max(score, Math.min(heur.score, 80));

    // Capa 2 · Web Risk (solo si no hay ya un veredicto malicioso de capa 1)
    let webRiskRan = false;
    if (deepAnalysis && this.webRisk.isEnabled && score < RISK_THRESHOLDS.malicious) {
      const threats = await this.webRisk.check(finalUrl);
      if (threats !== null) {
        webRiskRan = true;
        if (threats.length > 0) {
          score = Math.max(score, WEBRISK_SCORE);
          reasons.push({
            code: 'WEBRISK_HIT',
            layer: 'webrisk',
            severity: 'critical',
            title: 'Detectado por Google Web Risk',
            detail: `El sitio está marcado por ${threats.includes('SOCIAL_ENGINEERING') ? 'suplantación de identidad (phishing)' : 'distribución de software malicioso'} en la base de amenazas de Google.`,
          });
        }
      }
    }

    // Capa 3b · LLM, solo en la franja ambigua (ni claramente malo ni limpio)
    let llmRan = false;
    if (
      deepAnalysis &&
      this.llm.isEnabled &&
      score < RISK_THRESHOLDS.malicious &&
      score >= LLM_MIN_SCORE
    ) {
      const verdict = await this.llm.classify({
        submittedUrl: submitted.href,
        finalUrl: finalUrl.href,
        redirectChain: chain,
        heuristicSignals: heur.reasons.map((r) => r.code),
      });
      if (verdict) {
        llmRan = true;
        if (
          (verdict.intent === 'phishing' || verdict.intent === 'scam') &&
          verdict.confidence >= 0.6
        ) {
          score = Math.max(score, verdict.intent === 'phishing' ? 80 : 70);
          reasons.push({
            code: 'AI_SCAM_INTENT',
            layer: 'ai',
            severity: 'critical',
            title:
              verdict.intent === 'phishing'
                ? 'La IA detectó intento de phishing'
                : 'La IA detectó patrón de estafa',
            detail: verdict.rationale,
          });
        } else if (verdict.intent === 'legit' && verdict.confidence >= 0.7) {
          // Señal exculpatoria acotada: baja el ruido de heurísticas DÉBILES
          // (solo warnings/info, p. ej. un TLD barato en un sitio real). Si
          // alguna capa determinista encendió una señal CRÍTICA (imitación de
          // marca, punycode, IP, listas), el LLM no rebaja nada: el texto de
          // la URL es atacante-controlado y no tiene autoridad para declarar
          // "seguro" lo que las capas locales ya marcaron.
          const hasCriticalSignal = reasons.some(
            (r) => r.severity === 'critical',
          );
          if (!hasCriticalSignal) {
            score = Math.min(score, RISK_THRESHOLDS.suspicious - 5);
          }
        }
      }
    }

    // "Seguro" solo puede afirmarse si la capa 1 tenía datos cargados.
    const conclusive = this.blocklists.isReady;

    return {
      verdict: verdictFromScore(score, conclusive),
      riskScore: score,
      submittedUrl: submitted.href,
      finalUrl: finalUrl.href,
      domain: finalUrl.hostname,
      reasons,
      checkedLayers: {
        blocklists: conclusive,
        webrisk: webRiskRan,
        heuristics: true,
        ai: llmRan,
      },
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
  }
}
