import type {
  DeviceSecuritySignals,
  DomainBlockedEvent,
  ShieldStatus,
} from '@novashield/shared';
import type { EventSubscription } from 'expo-modules-core';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Puente con el módulo nativo del Escudo DNS y la Protección de Mensajes.
 *
 * `requireOptionalNativeModule` devuelve null cuando el módulo no está en el
 * binario (Expo Go, o la web): toda la app tiene que seguir funcionando sin
 * él, mostrando el escudo como "no disponible en este build" en vez de romper.
 *
 * Esta interfaz ES el contrato que implementan el módulo Kotlin y el Swift:
 * cambiarla acá obliga a cambiar los dos lados.
 */

type ShieldEvents = {
  /** El escudo frenó una consulta DNS a un dominio de la lista. */
  onDomainBlocked: (event: DomainBlockedEvent) => void;
  /** El estado cambió por fuera de la app (el usuario apagó la VPN, otra app tomó el túnel...). */
  onStatusChange: (event: { status: ShieldStatus }) => void;
};

export interface NovaShieldNative {
  /**
   * Los módulos de Expo son EventEmitter. Se declara a mano porque el tipo
   * `NativeModule` que exporta expo-modules-core describe la clase y no la
   * instancia, así que heredarlo deja los métodos de eventos fuera del tipo.
   */
  addListener<EventName extends keyof ShieldEvents>(
    eventName: EventName,
    listener: ShieldEvents[EventName],
  ): EventSubscription;

  // — Escudo DNS —
  getStatus(): ShieldStatus;
  /**
   * Pide el consentimiento del sistema (diálogo de VPN en Android, instalación
   * del perfil DNS en iOS). Resuelve en true si el usuario aceptó.
   */
  requestPermission(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Dónde debe escribirse la lista para que el proceso del escudo pueda leerla. */
  getBlocklistDirectory(): string;
  /** Carga la lista descargada. Devuelve cuántos dominios quedaron activos. */
  loadBlocklist(path: string, version: string): Promise<number>;
  /**
   * Cuántos dominios tiene la lista EN MEMORIA del proceso de la app. 0 después
   * de un reinicio del proceso: la capa JS lo usa para recargar desde disco sin
   * esperar al intervalo de sincronización.
   */
  getLoadedDomainCount(): number;
  getBlockedCount(): number;

  /**
   * Pide permiso de notificaciones (solo iOS; en Android el canal ya existe).
   * Sin esto, un bloqueo se ve igual que quedarse sin internet.
   */
  requestNotificationPermission?(): Promise<boolean>;

  /**
   * Bloqueos registrados por la extensión (solo iOS).
   *
   * En Android llegan por el evento `onDomainBlocked`; en iOS la extensión es
   * otro proceso y no puede emitirlo, así que la app los va a buscar.
   */
  getBlockedEvents?(): {
    count: number;
    recent: { domain: string; at: number }[];
  };

  /**
   * Contadores del túnel (solo iOS por ahora). Números, nunca dominios.
   * Sirven para saber en qué punto se corta la cadena sin pedirle a nadie que
   * conecte el teléfono a una Mac y filtre logs.
   */
  getShieldDiagnostics?(): {
    available: boolean;
    packets?: number;
    queries?: number;
    blocked?: number;
    listCount?: number;
    at?: number;
  };

  // — Escáner del Dispositivo —
  /**
   * Señales de postura de seguridad, todas leídas localmente y sin permisos.
   * La evaluación (pesos, textos) vive en packages/shared/src/device.ts.
   */
  getDeviceSecuritySignals(): DeviceSecuritySignals;
  /** Abre la sección de Ajustes que corresponde al chequeo (en iOS, los ajustes de la app). */
  openDeviceSettings(section: string): Promise<void>;

  // — Protección de Mensajes —
  /** Android: acceso a notificaciones. iOS: filtro de SMS activado en Ajustes. */
  isMessageProtectionEnabled(): boolean;
  /** Abre la pantalla de Ajustes del sistema donde se habilita. */
  openMessageProtectionSettings(): Promise<void>;
}

export const NovaShield = requireOptionalNativeModule<NovaShieldNative>('NovaShield');

/** true si este build trae el módulo nativo (development build o build de EAS). */
export const isShieldAvailable = NovaShield !== null;

export function getShieldStatus(): ShieldStatus {
  return NovaShield?.getStatus() ?? 'unsupported';
}
