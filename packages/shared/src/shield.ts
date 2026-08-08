/**
 * Contrato de distribución de la lista de bloqueo del Escudo DNS.
 *
 * Privacidad por diseño, sin asteriscos: el dispositivo descarga los hashes
 * truncados de los dominios bloqueados y hace TODO el matching localmente.
 * Ninguna consulta DNS del usuario —ni siquiera un prefijo— sale del teléfono,
 * y el escudo sigue funcionando sin señal.
 *
 * Por qué 8 bytes: con ~170.000 dominios la probabilidad de que un dominio
 * legítimo colisione con uno bloqueado es ~1 en 10^14, o sea nunca. Eso evita
 * el paso de "confirmación" contra el servidor que exigen los prefijos cortos
 * (modelo Safe Browsing), que agregaría una ida y vuelta HTTP en pleno camino
 * de la resolución DNS y filtraría telemetría de navegación.
 */

/** Bytes de SHA-256 que se conservan por dominio. Cambiarlo rompe cliente y servidor a la vez. */
export const HASH_BYTES = 8;

export interface BlocklistMetadata {
  /** Cambia cuando cambia el contenido; el cliente re-descarga solo si difiere. */
  version: string;
  domainCount: number;
  hashBytes: number;
  /** Tamaño de la descarga, para avisarle al usuario antes de bajarla con datos. */
  sizeBytes: number;
  updatedAt: string;
  /** Fuentes que componen la lista, para mostrar en la UI. */
  sources: string[];
}

/** Estado del Escudo DNS reportado por el módulo nativo. */
export type ShieldStatus =
  | 'active'
  | 'inactive'
  /** Otra VPN o perfil DNS tiene precedencia: la protección está pausada. */
  | 'preempted'
  /** El build o el dispositivo no soportan el escudo (p. ej. Expo Go). */
  | 'unsupported'
  /** Falta que el usuario lo habilite a mano en Ajustes. */
  | 'needs_permission';

export interface ShieldState {
  status: ShieldStatus;
  /** Dominios bloqueados desde que se activó, para el contador de la UI. */
  blockedCount: number;
  lastBlockedDomain: string | null;
  blocklistVersion: string | null;
  blocklistUpdatedAt: string | null;
}

/** Evento que el módulo nativo emite cuando frena una consulta. */
export interface DomainBlockedEvent {
  domain: string;
  /** Epoch en milisegundos. */
  at: number;
}
