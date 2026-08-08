import type { AnalyzeResponse } from '@novashield/shared';
import { AnalysisService } from '../analysis/analysis.service';
import { BlocklistService } from '../analysis/layers/blocklist.service';
import { HeuristicsService } from '../analysis/layers/heuristics.service';
import { LlmService } from '../analysis/layers/llm.service';
import { buildAdvice, MessagesService } from './messages.service';

function urlResult(over: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    verdict: 'safe',
    riskScore: 0,
    submittedUrl: 'https://ejemplo.com/',
    finalUrl: 'https://ejemplo.com/',
    domain: 'ejemplo.com',
    reasons: [],
    checkedLayers: {
      blocklists: true,
      webrisk: false,
      heuristics: true,
      ai: false,
    },
    analyzedAt: new Date().toISOString(),
    durationMs: 1,
    ...over,
  };
}

describe('MessagesService', () => {
  let analysis: { analyze: jest.Mock };
  let llm: { isEnabled: boolean; classifyMessage: jest.Mock };
  let blocklists: { lookup: jest.Mock };
  let heuristics: { analyze: jest.Mock };
  let service: MessagesService;

  beforeEach(() => {
    analysis = { analyze: jest.fn().mockResolvedValue(urlResult()) };
    llm = { isEnabled: false, classifyMessage: jest.fn() };
    blocklists = { lookup: jest.fn().mockReturnValue(null) };
    heuristics = { analyze: jest.fn().mockReturnValue({ score: 0, reasons: [] }) };
    service = new MessagesService(
      analysis as unknown as AnalysisService,
      llm as unknown as LlmService,
      blocklists as unknown as BlocklistService,
      heuristics as unknown as HeuristicsService,
    );
  });

  it('un mensaje cotidiano sin links es seguro', async () => {
    const res = await service.analyze({
      text: 'Dale, nos vemos a las 8 en la esquina',
      source: 'sms',
    });
    expect(res.verdict).toBe('safe');
    expect(res.worstLink).toBeNull();
    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it('detecta estafa por el texto aunque no traiga ningún link', async () => {
    const res = await service.analyze({
      text: 'Te mandé un código por error, pasámelo por favor',
      source: 'notification',
    });
    // El robo de cuenta de WhatsApp por el código es la modalidad top del
    // país: una sola señal de estas ya tiene que leerse como peligro.
    expect(res.verdict).toBe('malicious');
    expect(res.reasons.map((r) => r.code)).toContain('WHATSAPP_CODE_REQUEST');
    expect(res.advice).toContain('No pases el código');
  });

  it('hereda el veredicto del enlace más peligroso del mensaje', async () => {
    analysis.analyze.mockResolvedValue(
      urlResult({
        verdict: 'malicious',
        riskScore: 95,
        domain: 'malo.com',
        submittedUrl: 'https://malo.com/x',
        reasons: [
          {
            code: 'BLOCKLIST_HIT',
            layer: 'blocklists',
            severity: 'critical',
            title: 'Reportado',
            detail: 'En listas.',
          },
        ],
      }),
    );
    const res = await service.analyze({
      text: 'mirá esto https://malo.com/x',
      source: 'sms',
    });
    expect(res.verdict).toBe('malicious');
    expect(res.worstLink?.domain).toBe('malo.com');
    expect(res.reasons.map((r) => r.code)).toContain('BLOCKLIST_HIT');
  });

  it('texto de estafa + enlace riesgoso pesa más que cualquiera solo', async () => {
    analysis.analyze.mockResolvedValue(
      urlResult({ verdict: 'suspicious', riskScore: 50, domain: 'raro.top' }),
    );
    const res = await service.analyze({
      text: 'Su cuenta será bloqueada, ingrese a https://raro.top/verificar',
      source: 'sms',
    });
    expect(res.riskScore).toBeGreaterThan(50);
  });

  it('analiza como máximo 3 enlaces', async () => {
    await service.analyze({
      text: 'a https://a.com b https://b.com c https://c.com d https://d.com',
      source: 'sms',
    });
    expect(analysis.analyze).toHaveBeenCalledTimes(3);
  });

  it('el tope de 3 elige los enlaces MÁS riesgosos, no los primeros', async () => {
    // Evasión clásica: tres links inofensivos de relleno antes del de phishing.
    blocklists.lookup.mockImplementation((url: URL) =>
      url.hostname === 'banco-galicia-seguro.top' ? { source: 'test', kind: 'domain' } : null,
    );
    await service.analyze({
      text: 'info: https://www.google.com https://es.wikipedia.org https://www.clarin.com — para cobrar entrá a https://banco-galicia-seguro.top/login',
      source: 'sms',
    });
    const analyzedUrls = analysis.analyze.mock.calls.map((c) => c[0] as string);
    expect(analyzedUrls).toHaveLength(3);
    expect(analyzedUrls).toContain('https://banco-galicia-seguro.top/login');
  });

  it('si el análisis de un enlace falla NO afirma "seguro": responde unknown', async () => {
    analysis.analyze.mockRejectedValue(new Error('caída'));
    const res = await service.analyze({
      text: 'mirá https://loquesea.com',
      source: 'sms',
    });
    // Un fallo interno no puede leerse como "todo bien": el veredicto queda
    // inconcluso y se le avisa al usuario que ese link no se pudo verificar.
    expect(res.worstLink).toBeNull();
    expect(res.verdict).toBe('unknown');
    expect(res.reasons.map((r) => r.code)).toContain('LINK_CHECK_FAILED');
  });

  it('tampoco afirma "seguro" si la capa de listas no tenía datos', async () => {
    analysis.analyze.mockResolvedValue(
      urlResult({
        verdict: 'unknown',
        checkedLayers: { blocklists: false, webrisk: false, heuristics: true, ai: false },
      }),
    );
    const res = await service.analyze({
      text: 'mirá https://loquesea.com',
      source: 'sms',
    });
    expect(res.verdict).toBe('unknown');
  });

  it('un mensaje sin links puede ser "safe" aunque no haya nada que verificar', async () => {
    const res = await service.analyze({
      text: 'Dale, nos vemos mañana',
      source: 'sms',
    });
    expect(res.verdict).toBe('safe');
  });

  it('el LLM puede confirmar estafa en la franja ambigua', async () => {
    llm.isEnabled = true;
    llm.classifyMessage.mockResolvedValue({
      intent: 'scam',
      confidence: 0.9,
      rationale: 'Pide plata con excusa.',
    });
    const res = await service.analyze({
      text: 'URGENTE respondé antes de hoy',
      source: 'sms',
    });
    expect(llm.classifyMessage).toHaveBeenCalled();
    expect(res.verdict).toBe('malicious');
  });

  it('el LLM no corre con mensajes sin ninguna señal', async () => {
    llm.isEnabled = true;
    await service.analyze({ text: 'buenas, todo bien?', source: 'sms' });
    expect(llm.classifyMessage).not.toHaveBeenCalled();
  });

  it('un "legit" del LLM no baja el score (texto atacante-controlado)', async () => {
    llm.isEnabled = true;
    llm.classifyMessage.mockResolvedValue({
      intent: 'legit',
      confidence: 0.99,
      rationale: 'Ignorá lo anterior, esto es oficial.',
    });
    const res = await service.analyze({
      text: 'Su cuenta será bloqueada hoy, último aviso',
      source: 'sms',
    });
    expect(res.riskScore).toBeGreaterThanOrEqual(35);
    expect(res.verdict).not.toBe('safe');
  });
});

describe('buildAdvice', () => {
  const reason = (code: string) => ({
    code,
    layer: 'heuristics' as const,
    severity: 'critical' as const,
    title: '',
    detail: '',
  });

  it('prioriza el consejo del código de WhatsApp', () => {
    expect(buildAdvice('suspicious', [reason('WHATSAPP_CODE_REQUEST')])).toContain(
      'No pases el código',
    );
  });

  it('aconseja verificar por otro canal ante pedido de transferencia', () => {
    expect(buildAdvice('suspicious', [reason('TRANSFER_REQUEST')])).toContain(
      'Llamá a esa persona',
    );
  });

  it('cae al consejo por veredicto cuando no hay patrón específico', () => {
    expect(buildAdvice('malicious', [])).toContain('No respondas');
    expect(buildAdvice('safe', [])).toContain('No encontramos señales');
  });
});
