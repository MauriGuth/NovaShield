import {
  evaluateDeviceSecurity,
  type DeviceScanResult,
  type DeviceSecuritySignals,
} from '@novashield/shared';
import { Platform } from 'react-native';
import { NovaShield } from './native-shield';

/**
 * Escáner del Dispositivo (lado app).
 *
 * Junta las señales del módulo nativo y las evalúa con la lógica compartida.
 * Nada de esto sale del teléfono: no hay ninguna llamada de red en este
 * archivo, y no debería haberla nunca.
 */

/** true si este build puede leer las señales del sistema. */
export const isDeviceScanAvailable =
  NovaShield !== null && typeof NovaShield.getDeviceSecuritySignals === 'function';

export function scanDevice(now: Date = new Date()): DeviceScanResult | null {
  if (!isDeviceScanAvailable) return null;

  const signals = NovaShield!.getDeviceSecuritySignals();
  return evaluateDeviceSecurity(normalizeSignals(signals), now);
}

/**
 * El puente nativo puede mandar `null` donde el tipo espera `undefined` (y en
 * Android los `Map` con valores nulos llegan así). Se normaliza acá para que la
 * evaluación no confunda "no sé" con "false" — la diferencia importa: `rooted:
 * undefined` no muestra ningún chequeo, `rooted: false` muestra "sin señales de
 * root".
 */
function normalizeSignals(raw: DeviceSecuritySignals): DeviceSecuritySignals {
  const value = raw as unknown as Record<string, unknown>;
  const bool = (key: string): boolean | undefined =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : undefined;

  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    osVersion:
      typeof value.osVersion === 'string' && value.osVersion
        ? value.osVersion
        : String(Platform.Version),
    securityPatch:
      typeof value.securityPatch === 'string' && value.securityPatch
        ? value.securityPatch
        : undefined,
    screenLock: bool('screenLock') ?? false,
    biometrics: bool('biometrics'),
    developerOptions: bool('developerOptions'),
    usbDebugging: bool('usbDebugging'),
    rooted: bool('rooted'),
    accessibilityServices: Array.isArray(value.accessibilityServices)
      ? (value.accessibilityServices as unknown[]).filter(
          (s): s is string => typeof s === 'string',
        )
      : undefined,
  };
}

/** Abre la sección de Ajustes que corresponde a un chequeo. */
export async function openSettingsFor(section: string): Promise<void> {
  await NovaShield?.openDeviceSettings(section);
}
