import { BadRequestException } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { BlocklistService } from './layers/blocklist.service';
import { HeuristicsService } from './layers/heuristics.service';
import { LlmService } from './layers/llm.service';
import { WebRiskService } from './layers/webrisk.service';

/**
 * Tests del merge de veredictos con las capas externas mockeadas.
 * Las heurísticas reales sí corren (son puras y locales).
 */
describe('AnalysisService', () => {
  let blocklists: jest.Mocked<
    Pick<BlocklistService, 'lookup'> & { isReady: boolean }
  >;
  let webRisk: { isEnabled: boolean; check: jest.Mock };
  let llm: { isEnabled: boolean; classify: jest.Mock };
  let service: AnalysisService;

  beforeEach(() => {
    blocklists = { lookup: jest.fn().mockReturnValue(null), isReady: true };
    webRisk = { isEnabled: false, check: jest.fn() };
    llm = { isEnabled: false, classify: jest.fn() };
    service = new AnalysisService(
      blocklists as unknown as BlocklistService,
      new HeuristicsService(),
      webRisk as unknown as WebRiskService,
      llm as unknown as LlmService,
    );
  });

  it('rechaza texto sin ningún enlace', async () => {
    await expect(service.analyze('hola')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('devuelve safe para un dominio limpio con listas cargadas', async () => {
    const result = await service.analyze('https://www.mercadopago.com.ar/');
    expect(result.verdict).toBe('safe');
    expect(result.riskScore).toBe(0);
    expect(result.checkedLayers.blocklists).toBe(true);
  });

  it('devuelve unknown si las listas todavía no cargaron', async () => {
    blocklists.isReady = false;
    const result = await service.analyze('https://sitio-desconocido.com/');
    expect(result.verdict).toBe('unknown');
  });

  it('match de listas por URL → malicious con razón crítica', async () => {
    blocklists.lookup.mockReturnValue({ source: 'phishtank', kind: 'url' });
    const result = await service.analyze('https://sitio-malo.com/login');
    expect(result.verdict).toBe('malicious');
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
    expect(result.reasons[0].code).toBe('BLOCKLIST_HIT');
  });

  it('hit de Web Risk eleva a malicious', async () => {
    webRisk.isEnabled = true;
    webRisk.check.mockResolvedValue(['SOCIAL_ENGINEERING']);
    const result = await service.analyze('https://raro-pero-nuevo.com/');
    expect(result.verdict).toBe('malicious');
    expect(result.checkedLayers.webrisk).toBe(true);
  });

  it('el LLM corre solo en la franja ambigua y puede confirmar phishing', async () => {
    llm.isEnabled = true;
    llm.classify.mockResolvedValue({
      intent: 'phishing',
      confidence: 0.9,
      rationale: 'Imita a un banco.',
    });
    // Heurísticas suman (acortador) → franja ambigua → LLM confirma.
    const result = await service.analyze('https://bit.ly/xyz');
    expect(llm.classify).toHaveBeenCalled();
    expect(result.verdict).toBe('malicious');
    expect(result.reasons.map((r) => r.code)).toContain('AI_SCAM_INTENT');
  });

  it('el LLM no corre para URLs sin ninguna señal', async () => {
    llm.isEnabled = true;
    await service.analyze('https://www.ejemplo.com/');
    expect(llm.classify).not.toHaveBeenCalled();
  });

  it('un legit confiable del LLM baja heurísticas débiles a safe', async () => {
    llm.isEnabled = true;
    llm.classify.mockResolvedValue({
      intent: 'legit',
      confidence: 0.9,
      rationale: 'Sitio conocido.',
    });
    const result = await service.analyze('https://empresa-seria.click/');
    expect(result.verdict).toBe('safe');
  });

  it('un legit del LLM NO pisa una señal crítica determinista (falso negativo)', async () => {
    llm.isEnabled = true;
    llm.classify.mockResolvedValue({
      intent: 'legit',
      confidence: 0.95,
      rationale: 'Dice ser el sitio oficial.',
    });
    // Imitación de marca = razón crítica: el LLM no puede declararlo seguro.
    const result = await service.analyze('https://mercadopago-seguridad.top/ingresar');
    expect(result.verdict).not.toBe('safe');
    expect(result.reasons.map((r) => r.code)).toContain('BRAND_IMPERSONATION');
  });
});
