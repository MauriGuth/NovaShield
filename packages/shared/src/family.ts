/**
 * Modo Familia: contrato de la API.
 *
 * PRIVACIDAD (la regla que define el feature): lo ÚNICO que un integrante
 * comparte con su familia es su estado de protección — booleanos, contadores y
 * un score. Nunca dominios visitados, nunca contenido de mensajes, nunca
 * ubicación. Todos los integrantes se unen voluntariamente ingresando el
 * código en SU teléfono, ven exactamente lo mismo que ven los demás sobre
 * ellos, y pueden salir cuando quieran. No hay modo oculto.
 */

/** Máximo de integrantes por familia (plan Familia del anteproyecto). */
export const FAMILY_MAX_MEMBERS = 10;

/**
 * Foto del estado de protección de un integrante. SOLO agregados: si estás por
 * agregar un campo acá, preguntate si le contás a la familia algo sobre el
 * CONTENIDO de la actividad del integrante — si sí, no va.
 */
export interface FamilyMemberStatus {
  /** ¿El Escudo DNS está activo ahora? */
  shieldActive: boolean;
  /** Última actualización de la lista de bloqueo (ISO), si se sabe. */
  blocklistUpdatedAt: string | null;
  /** Score del Escáner del Dispositivo (0-100), si corrió alguna vez. */
  deviceScanScore: number | null;
  /** Total de dominios bloqueados por el escudo en este dispositivo. */
  blockedCount: number;
  /** Total de alertas (enlaces/mensajes peligrosos detectados). */
  alertCount: number;
  /** Cuándo reportó esto el dispositivo (lo pone el servidor). */
  reportedAt: string;
}

export interface FamilyMember {
  id: string;
  displayName: string;
  role: 'admin' | 'member';
  joinedAt: string;
  /** null hasta que el dispositivo reporte por primera vez. */
  status: FamilyMemberStatus | null;
  /** true en la respuesta para el integrante que consulta. */
  isYou: boolean;
}

export interface FamilyOverview {
  id: string;
  name: string;
  /** Código para invitar; lo ven todos los integrantes. */
  inviteCode: string;
  createdAt: string;
  members: FamilyMember[];
}

// — Requests/Responses —

export interface CreateFamilyRequest {
  /** Nombre de la familia, p. ej. "Los Pérez". */
  name: string;
  /** Cómo se muestra quien la crea, p. ej. "Mamá". */
  displayName: string;
}

export interface JoinFamilyRequest {
  inviteCode: string;
  displayName: string;
}

/**
 * Al crear o unirse se emite el token del integrante. Se muestra UNA sola vez:
 * el servidor guarda solo su hash.
 */
export interface FamilyAuthResponse {
  family: FamilyOverview;
  memberId: string;
  memberToken: string;
}

export type ReportFamilyStatusRequest = Omit<FamilyMemberStatus, 'reportedAt'>;
