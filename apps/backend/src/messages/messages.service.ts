import { Injectable } from '@nestjs/common';
import {
  AnalysisReason,
  AnalyzeMessageRequest,
  AnalyzeMessageResponse,
  RISK_THRESHOLDS,
  VerdictLevel,
  verdictFromScore,
} from '@novashield/shared';
import { AnalysisService } from '../analysis/analysis.service';
import { BlocklistService } from '../analysis/layers/blocklist.service';
import { HeuristicsService } from '../analysis/layers/heuristics.service';
import { LlmService } from '../analysis/layers/llm.service';
import { extractUrls } from '../analysis/url-utils';
import { matchScamPatterns } from './scam-patterns';

/**
 * Protección de Mensajes: analiza el texto de un SMS, notificación o mail.
 *
 * Dos señales independientes que se combinan: los enlaces que trae (reusando
 * el motor de URLs completo) y los patrones de estafa del texto. Un mensaje
 * puede ser peligroso sin ningún link ("pasame el código que te llegó") y un
 * texto inocuo puede traer un link letal; hay que cubrir los dos casos.
 */

/** Máximo de enlaces con análisis COMPLETO (expansión, Web Risk): acota latencia y costo. */
const MAX_LINKS = 3;
/** Máximo de candidatos que se rankean localmente antes de elegir esos 3. */
const MAX_CANDIDATES = 20;
/** Franja ambigua donde vale la pena preguntarle al modelo. */
const LLM_MIN_SCORE = 15;

@Injectable()
export class MessagesService {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly llm: LlmService,
    private readonly blocklists: BlocklistService,
    private readonly heuristics: HeuristicsService,
  ) {}

  async analyze(input: AnalyzeMessageRequest): Promise<AnalyzeMessageResponse> {
    const startedAt = Date.now();
    const reasons: AnalysisReason[] = [];
    // Mismo contrato que /v1/analyze: `false` apaga las capas pagas (Web Risk
    // en los links + IA), nunca las locales. El plan gratuito pasado su tope
    // sigue recibiendo veredicto por listas, heurísticas y patrones.
    const deepAnalysis = input.deepAnalysis !== false;

    // Señal 1 · enlaces del mensaje. El tope de análisis completo NO puede ser
    // "los primeros 3 que aparecen": el atacante controla el orden y evadiría
    // el filtro anteponiendo tres links inofensivos al de phishing. Por eso se
    // extraen todos los candidatos y un ranking local barato (blocklist en
    // memoria + heurísticas, sin red) elige los más riesgosos para el análisis
    // caro.
    const candidates = extractUrls(input.text, MAX_CANDIDATES);
    const urls =
      candidates.length <= MAX_LINKS
        ? candidates
        : candidates
            .map((url, order) => ({ url, order, risk: this.localRisk(url) }))
            .sort((a, b) => b.risk - a.risk || a.order - b.order)
            .slice(0, MAX_LINKS)
            .map((ranked) => ranked.url);

    const linkResults = await Promise.all(
      urls.map((url) =>
        this.analysis.analyze(url.href, { deepAnalysis }).catch(() => null),
      ),
    );
    const analyzed = linkResults.filter((r) => r !== null);
    const worst = analyzed.reduce<(typeof analyzed)[number] | null>(
      (acc, r) => (acc === null || r.riskScore > acc.riskScore ? r : acc),
      null,
    );

    let linkScore = 0;
    if (worst) {
      linkScore = worst.riskScore;
      // Las razones del enlace ya vienen redactadas para el usuario.
      reasons.push(...worst.reasons);
    }

    // Señal 2 · patrones de estafa en el texto.
    const text = matchScamPatterns(input.text);
    reasons.push(...text.reasons);

    let score = Math.max(linkScore, text.score);
    // Texto de estafa + enlace riesgoso es peor que cualquiera por separado.
    if (linkScore >= RISK_THRESHOLDS.suspicious && text.score >= 30) {
      score = Math.min(100, score + 15);
    }

    // Señal 3 · intención según el modelo, solo en la franja ambigua.
    if (
      deepAnalysis &&
      this.llm.isEnabled &&
      score < RISK_THRESHOLDS.malicious &&
      score >= LLM_MIN_SCORE
    ) {
      const verdict = await this.llm.classifyMessage({
        text: input.text,
        sender: input.sender,
        heuristicSignals: reasons.map((r) => r.code),
      });
      if (
        verdict &&
        (verdict.intent === 'phishing' || verdict.intent === 'scam') &&
        verdict.confidence >= 0.6
      ) {
        score = Math.max(score, 80);
        reasons.push({
          code: 'AI_SCAM_INTENT',
          layer: 'ai',
          severity: 'critical',
          title: 'La IA detectó un patrón de estafa',
          detail: verdict.rationale,
        });
      }
      // Un "legit" del modelo NO baja el score: el texto del mensaje es
      // atacante-controlado y podría pedirle que lo declare inofensivo.
    }

    // El mensaje menciona algo con pinta de enlace ("https:/", "www.") pero la
    // extracción no encontró NINGUNA URL: casi siempre es un link cortado o
    // mal pegado. No se puede declarar "seguro" un mensaje cuyo enlace no se
    // pudo ni leer — se degrada a unknown y se le dice al usuario qué pasó.
    const linkDebris =
      urls.length === 0 && /https?[:/]|www\./i.test(input.text);
    if (linkDebris) {
      reasons.push({
        code: 'LINK_UNREADABLE',
        layer: 'heuristics',
        severity: 'warning',
        title: 'Hay algo con pinta de enlace que no pudimos leer',
        detail:
          'El mensaje menciona un enlace pero parece estar cortado o mal pegado, así que no lo pudimos verificar. Si lo querés revisar, pegá el link completo (con https://) en el escáner.',
      });
    }

    // "Seguro" solo puede afirmarse si los enlaces del mensaje efectivamente
    // se verificaron con las listas cargadas. Si algún análisis falló, quedó
    // un enlace ilegible o la capa 1 estaba vacía, el veredicto con score bajo
    // es "unknown", no "safe": un producto de seguridad no puede convertir sus
    // propias fallas en un "todo bien".
    const conclusive =
      !linkDebris &&
      analyzed.length === urls.length &&
      (urls.length === 0 ||
        analyzed.every((r) => r.checkedLayers.blocklists));
    if (analyzed.length < urls.length) {
      reasons.push({
        code: 'LINK_CHECK_FAILED',
        layer: 'blocklists',
        severity: 'warning',
        title: 'No pudimos verificar todos los enlaces',
        detail:
          'Alguno de los enlaces del mensaje no se pudo analizar. Tratalo con cuidado: que no aparezca una alerta no significa que sea seguro.',
      });
    }

    const verdict = verdictFromScore(score, conclusive);

    return {
      verdict,
      riskScore: score,
      reasons,
      worstLink: worst
        ? {
            url: worst.submittedUrl,
            domain: worst.domain,
            verdict: worst.verdict,
            riskScore: worst.riskScore,
          }
        : null,
      advice: buildAdvice(verdict, reasons),
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Riesgo local de un enlace, sin red: listas en memoria + heurísticas sobre
   * el string. Solo ordena candidatos — el veredicto lo da el análisis
   * completo.
   */
  private localRisk(url: URL): number {
    if (this.blocklists.lookup(url)) return 1000;
    return this.heuristics.analyze(url, false).score;
  }
}

/**
 * Qué hacer, en una línea. Prioriza el consejo del patrón más grave detectado
 * porque no es lo mismo "no abras el link" que "no pases ese código".
 */
export function buildAdvice(
  verdict: VerdictLevel,
  reasons: AnalysisReason[],
): string {
  const codes = new Set(reasons.map((r) => r.code));

  if (codes.has('WHATSAPP_CODE_REQUEST')) {
    return 'No pases el código por ningún motivo. Si ya lo enviaste, entrá YA a WhatsApp y volvé a registrar tu número; después avisale a tus contactos.';
  }
  if (codes.has('FAMILY_IMPERSONATION') || codes.has('TRANSFER_REQUEST')) {
    return 'No transfieras nada todavía. Llamá a esa persona al número que ya tenías guardado y confirmá con ella antes de mover un peso.';
  }
  if (codes.has('CREDENTIAL_REQUEST')) {
    return 'No entregues claves ni tokens. Si dudás, cortá y comunicate con tu banco por el número que figura en el dorso de la tarjeta.';
  }

  switch (verdict) {
    case 'malicious':
      return 'No respondas ni abras los enlaces. Borralo y, si venía de un contacto conocido, avisale que le robaron la cuenta.';
    case 'suspicious':
      return 'Tratalo con desconfianza: no abras los enlaces y verificá por un canal oficial antes de hacer nada.';
    case 'safe':
      return 'No encontramos señales de estafa. Igual, nunca compartas claves ni códigos que te lleguen por mensaje.';
    default:
      return 'No pudimos completar todas las verificaciones. Ante la duda, no abras los enlaces ni respondas datos personales.';
  }
}
