/**
 * Planes de Nova Shield.
 *
 * CRITERIO DE QUÉ SE COBRA (leer antes de mover un feature de plan):
 *
 * Lo que evita un daño INMEDIATO y verificable no se cobra nunca. Si alguien
 * está por caer en una estafa y la app sabe cómo evitarlo, cobrarle por el
 * aviso es indefendible — y además destruye la propuesta de valor del
 * producto, que es la honestidad. Por eso quedan gratis para siempre:
 *
 *   - Analizar un enlace cuando el usuario lo pide (con un tope diario).
 *   - Analizar un mensaje pegado a mano (mismo tope).
 *   - El Centro de Alertas y el Score.
 *   - El Escáner del Dispositivo, que es 100% local y no nos cuesta nada.
 *
 * Lo que se cobra es la protección CONTINUA y desatendida —la que corre sola
 * todo el día, consume infraestructura y es el trabajo real del producto— más
 * la comodidad de compartirla con la familia.
 *
 * El tope del plan gratuito NUNCA puede dejar a alguien sin respuesta frente a
 * un enlace concreto: al llegar al límite se sigue aplicando el análisis local
 * (listas + heurísticas) y solo se apagan las capas caras. Ver `FREE_LIMITS`.
 */

export type PlanTier = 'free' | 'premium' | 'family';

/** Identificadores de entitlement en RevenueCat (deben coincidir con el panel). */
export const ENTITLEMENTS = {
  premium: 'premium',
  family: 'familia',
} as const;

/** Capacidades que el plan habilita. */
export type Capability =
  /** Escudo DNS corriendo en segundo plano. */
  | 'shield'
  /** Revisión automática de mensajes entrantes. */
  | 'messageGuard'
  /** Modo Familia (crear o unirse a un grupo). */
  | 'family'
  /** Análisis con las capas caras (Web Risk + IA) sin tope. */
  | 'unlimitedAnalysis';

const CAPABILITIES: Record<PlanTier, readonly Capability[]> = {
  free: [],
  premium: ['shield', 'messageGuard', 'unlimitedAnalysis'],
  family: ['shield', 'messageGuard', 'unlimitedAnalysis', 'family'],
};

export function planHas(plan: PlanTier, capability: Capability): boolean {
  return CAPABILITIES[plan].includes(capability);
}

/**
 * Límites del plan gratuito.
 *
 * `analysesPerDay` NO es un muro: pasado el tope, el análisis sigue
 * respondiendo con las capas deterministas (listas de amenazas + heurísticas),
 * que son las que atajan la mayoría del phishing real. Lo que se apaga es la
 * verificación con Web Risk y la clasificación con IA, que son las que cuestan
 * plata por consulta. El usuario siempre recibe un veredicto.
 */
export const FREE_LIMITS = {
  analysesPerDay: 10,
} as const;

export interface PlanState {
  tier: PlanTier;
  /** Análisis hechos hoy (se reinicia con la fecha local). */
  analysesToday: number;
  /** Fecha (YYYY-MM-DD local) del contador. */
  analysesDate: string;
}

/** ¿Este análisis puede usar las capas pagas? */
export function canUseDeepAnalysis(state: PlanState): boolean {
  if (planHas(state.tier, 'unlimitedAnalysis')) return true;
  return state.analysesToday < FREE_LIMITS.analysesPerDay;
}

/** Texto del plan para mostrar en la UI. */
export const PLAN_LABELS: Record<PlanTier, string> = {
  free: 'Gratis',
  premium: 'Premium',
  family: 'Familia',
};
