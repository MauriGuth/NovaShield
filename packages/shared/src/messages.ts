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
  /**
   * `false` apaga las capas pagas (Web Risk + IA), igual que en /v1/analyze:
   * lo manda la app cuando un usuario del plan gratuito superó su tope diario.
   * Los patrones de estafa y las listas locales corren SIEMPRE — nadie se
   * queda sin veredicto frente a un mensaje sospechoso.
   */
  deepAnalysis?: boolean;
}

/**
 * ¿Lo que pegó el usuario es un link suelto o un mensaje?
 *
 * Decide a qué endpoint va: un solo token (sin espacios) SIEMPRE va a
 * /v1/analyze, y cualquier cosa con espacios va a /v1/messages/analyze, que
 * además de analizar los links que traiga busca los patrones de estafa en el
 * texto.
 *
 * Por qué un token suelto nunca va al camino de mensajes: los patrones de
 * estafa necesitan oraciones, así que sobre un token el analizador de mensajes
 * solo puede responder "sin señales" — y eso, dicho de un link mal pegado
 * ("https:/ejemplo.com", ".ejemplo.com") que no se pudo extraer ni analizar,
 * es una tranquilidad falsa. El camino de URLs en cambio lo analiza si se
 * entiende, y si no falla VISIBLE, con la instrucción de pegar el link
 * completo. En una app de seguridad, un error que corrige vale más que un
 * "seguro" que no verificó nada.
 */
export function scanInputKind(text: string): 'link' | 'message' {
  const trimmed = text.trim();
  if (!trimmed) return 'message';
  return /\s/.test(trimmed) ? 'message' : 'link';
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
