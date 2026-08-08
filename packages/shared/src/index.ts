/**
 * Contrato de la API de análisis de Nova Shield.
 * Compartido entre el backend (NestJS) y la app móvil (Expo).
 */

/** Nivel de veredicto sobre un enlace analizado. */
export type VerdictLevel = 'malicious' | 'suspicious' | 'safe' | 'unknown';

/** Severidad de una razón individual del análisis. */
export type ReasonSeverity = 'info' | 'warning' | 'critical';

/** Capas del motor de análisis (ver docs/decisiones-tecnicas.md). */
export type AnalysisLayer = 'blocklists' | 'webrisk' | 'heuristics' | 'ai';

export interface AnalyzeRequest {
  /** URL o texto pegado/compartido por el usuario. */
  url: string;
}

/**
 * Una razón del veredicto, pensada para mostrarse tal cual al usuario:
 * título corto + explicación educativa en lenguaje simple.
 */
export interface AnalysisReason {
  /** Código estable para métricas y tests, p. ej. `BLOCKLIST_HIT` o `SHORTENED_URL`. */
  code: string;
  layer: AnalysisLayer;
  severity: ReasonSeverity;
  title: string;
  detail: string;
}

export interface AnalyzeResponse {
  verdict: VerdictLevel;
  /** 0 (sin señales de riesgo) a 100 (malicioso confirmado). */
  riskScore: number;
  submittedUrl: string;
  /** URL final después de expandir acortadores/redirecciones en el servidor. */
  finalUrl: string;
  domain: string;
  reasons: AnalysisReason[];
  /** Qué capas llegaron a evaluar este enlace (las capas 2 y 3b dependen de configuración). */
  checkedLayers: Record<AnalysisLayer, boolean>;
  analyzedAt: string;
  durationMs: number;
}

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  blocklists: {
    exactUrls: number;
    domains: number;
    lastRefreshAt: string | null;
    sources: string[];
  };
  layers: Record<AnalysisLayer, boolean>;
}

/** Umbrales del veredicto — una sola fuente de verdad para backend y UI. */
export const RISK_THRESHOLDS = {
  malicious: 75,
  suspicious: 40,
} as const;

export function verdictFromScore(score: number, conclusive: boolean): VerdictLevel {
  if (score >= RISK_THRESHOLDS.malicious) return 'malicious';
  if (score >= RISK_THRESHOLDS.suspicious) return 'suspicious';
  return conclusive ? 'safe' : 'unknown';
}
