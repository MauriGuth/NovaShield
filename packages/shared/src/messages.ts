import type { AnalysisReason, VerdictLevel } from './index';

/**
 * Contrato de la Protección de Mensajes.
 *
 * El origen importa para lo que la app puede prometer: en Android el listener
 * de notificaciones ve SMS, WhatsApp y mail en tiempo real; en iOS el filtro
 * de SMS solo ve remitentes desconocidos y NO puede alertar (solo clasificar),
 * así que ahí el resto llega por "compartir con Nova Shield".
 */
export type MessageSource =
  | 'sms'
  | 'notification'
  | 'email'
  | 'manual';

export interface AnalyzeMessageRequest {
  /** Texto del mensaje. El backend extrae URLs y busca patrones de estafa. */
  text: string;
  /** Remitente tal como lo muestra el sistema (número, nombre o app). */
  sender?: string;
  source: MessageSource;
}

export interface AnalyzeMessageResponse {
  verdict: VerdictLevel;
  riskScore: number;
  reasons: AnalysisReason[];
  /** Veredicto del enlace más peligroso hallado en el texto, si había alguno. */
  worstLink: {
    url: string;
    domain: string;
    verdict: VerdictLevel;
    riskScore: number;
  } | null;
  /** Qué hacer, en una línea, listo para mostrar. */
  advice: string;
  analyzedAt: string;
  durationMs: number;
}
