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
 * Decide a qué endpoint va: un link suelto rinde más en /v1/analyze (muestra
 * redirecciones y capas), y cualquier otra cosa va a /v1/messages/analyze, que
 * además de analizar los links que traiga busca los patrones de estafa en el
 * texto. El sesgo es deliberado hacia "mensaje": un mensaje clasificado como
 * link pierde la detección de patrones (o directamente falla con "no
 * encontramos ningún enlace"), mientras que un link clasificado como mensaje
 * se analiza igual de completo — solo se ve una tarjeta menos detallada.
 */
export function scanInputKind(text: string): 'link' | 'message' {
  const trimmed = text.trim();
  // Espacios adentro = hay más que un link: eso es un mensaje.
  if (!trimmed || /\s/.test(trimmed)) return 'message';
  if (/^https?:\/\//i.test(trimmed)) return 'link';
  // Dominio pelado en un solo token ("bit.ly/x", "mercadolıbre.com.ar"). Se
  // permiten letras unicode en el dominio —así se escriben los lookalikes—
  // pero la última etiqueta (el TLD) tiene que ser ASCII: los TLD reales lo
  // son, y esto evita tratar "hola.qué" como si fuera un link.
  return /^[\p{L}0-9][\p{L}0-9.-]*\.[a-z0-9-]{2,}(?:[/?#]\S*)?$/iu.test(trimmed)
    ? 'link'
    : 'message';
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
