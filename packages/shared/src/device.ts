/**
 * Escáner del Dispositivo: contrato y lógica de evaluación.
 *
 * Las SEÑALES las junta el módulo nativo de cada plataforma; la EVALUACIÓN
 * (qué significa cada una, cuánto pesa, qué consejo dar) vive acá para que sea
 * una sola, testeable y con los textos revisados en un único lugar.
 *
 * PRIVACIDAD: todo el escaneo es on-device. Las señales crudas nunca se mandan
 * al backend; lo único que puede salir del teléfono es el score numérico (y
 * solo si el usuario está en Modo Familia).
 */

export interface DeviceSecuritySignals {
  platform: 'android' | 'ios';
  /** Versión del sistema, p. ej. "17.5" o "15". */
  osVersion: string;
  /** Android: fecha del parche de seguridad (YYYY-MM-DD). */
  securityPatch?: string;
  /** ¿Hay bloqueo de pantalla configurado (PIN/patrón/contraseña/biometría)? */
  screenLock: boolean;
  /** ¿Hay biometría configurada además del código? */
  biometrics?: boolean;
  /**
   * Android: opciones de desarrollador habilitadas.
   *
   * OJO: hoy el módulo nativo NO puede leer esto — `Settings.Global`
   * documenta que `DEVELOPMENT_SETTINGS_ENABLED` y `ADB_ENABLED` "always
   * return 0 for all third-party apps". Los campos siguen en el contrato
   * porque la evaluación los soporta si algún día hay una vía legítima, pero
   * `undefined` significa "no lo sabemos" y NUNCA debe producir un chequeo en
   * verde: decirle a alguien que su depuración USB está apagada sin poder
   * verificarlo es exactamente el tipo de falsa tranquilidad que este
   * producto no puede dar.
   */
  developerOptions?: boolean;
  /** Android: depuración USB habilitada. Mismo límite que `developerOptions`. */
  usbDebugging?: boolean;
  /** Root (Android) o jailbreak (iOS) detectado por heurísticas locales. */
  rooted?: boolean;
  /**
   * Android: servicios de accesibilidad HABILITADOS (componentes aplanados,
   * p. ej. "com.ejemplo.app/com.ejemplo.app.MiServicio"). Los troyanos
   * bancarios de la región abusan de accesibilidad para leer la pantalla y
   * tocar por el usuario; un servicio desconocido acá es una señal seria.
   */
  accessibilityServices?: string[];
}

export type DeviceCheckStatus = 'ok' | 'info' | 'warning' | 'critical';

/** Un chequeo del escáner, listo para mostrarse tal cual. */
export interface DeviceCheck {
  /** Código estable para métricas y tests. */
  code: string;
  status: DeviceCheckStatus;
  title: string;
  detail: string;
  /** Qué hacer, en una línea. Solo cuando el estado no es `ok`. */
  advice?: string;
  /** Sección de Ajustes que abre el botón de la UI (la resuelve el nativo). */
  settingsSection?: 'security' | 'developer' | 'accessibility' | 'update';
}

export interface DeviceScanResult {
  /** 0 (muy expuesto) a 100 (configuración sólida). */
  score: number;
  checks: DeviceCheck[];
  scannedAt: string;
}

/**
 * Paquetes de accesibilidad conocidos y legítimos (asistencia de Google y de
 * fabricantes).
 *
 * La comparación es por IGUALDAD del nombre de paquete, nunca por prefijo: con
 * `startsWith`, un troyano que se llame `com.google.android.accessibility.robo`
 * se haría pasar por servicio de Google y el escáner lo daría por bueno. El
 * nombre de paquete lo elige el atacante — es entrada controlada por él, y se
 * trata como tal.
 *
 * Un componente de accesibilidad llega aplanado como `paquete/clase`, así que
 * primero se recorta al paquete y recién ahí se compara.
 */
const KNOWN_ACCESSIBILITY_PACKAGES = new Set([
  'com.google.android.marvin.talkback',
  'com.google.android.apps.accessibility.voiceaccess',
  'com.google.android.apps.accessibility.reveal',
  'com.google.android.apps.accessibility.maui.actionblocks',
  'com.google.android.accessibility.switchaccess',
  'com.google.android.accessibility.selecttospeak',
  'com.google.audio.hearing.visualization.accessibility.scribe',
  'com.samsung.accessibility',
  'com.samsung.android.accessibility.talkback',
  'com.android.switchaccess',
]);

/** Paquete de un componente aplanado (`paquete/clase` → `paquete`). */
export function accessibilityPackageOf(component: string): string {
  const slash = component.indexOf('/');
  return (slash >= 0 ? component.slice(0, slash) : component).trim().toLowerCase();
}

/** Umbrales de vejez del parche de seguridad de Android, en días. */
const PATCH_WARNING_DAYS = 180;
const PATCH_CRITICAL_DAYS = 365;

/**
 * Evalúa las señales y arma el reporte. `now` se inyecta para poder testear la
 * vejez del parche con fechas fijas.
 */
export function evaluateDeviceSecurity(
  signals: DeviceSecuritySignals,
  now: Date = new Date(),
): DeviceScanResult {
  const checks: DeviceCheck[] = [];
  let score = 100;

  const add = (penalty: number, check: DeviceCheck) => {
    score -= penalty;
    checks.push(check);
  };

  // — Bloqueo de pantalla: la base de todo —
  if (signals.screenLock) {
    add(0, {
      code: 'SCREEN_LOCK_OK',
      status: 'ok',
      title: 'Bloqueo de pantalla activo',
      detail: 'Tu teléfono pide un código o biometría para desbloquearse. Es la primera barrera si te lo roban.',
    });
  } else {
    add(30, {
      code: 'NO_SCREEN_LOCK',
      status: 'critical',
      title: 'Sin bloqueo de pantalla',
      detail:
        'Cualquiera que agarre tu teléfono puede entrar a tu WhatsApp, tu correo y tu banco. Con los robos de celulares en la vía pública, esto es lo primero que hay que cerrar.',
      advice: 'Configurá un PIN o biometría ahora mismo, tarda un minuto.',
      settingsSection: 'security',
    });
  }

  // — Root / jailbreak —
  if (signals.rooted) {
    add(30, {
      code: signals.platform === 'ios' ? 'JAILBREAK_DETECTED' : 'ROOT_DETECTED',
      status: 'critical',
      title: signals.platform === 'ios' ? 'Jailbreak detectado' : 'Teléfono con root',
      detail:
        signals.platform === 'ios'
          ? 'Este iPhone parece tener jailbreak: las protecciones de Apple están desactivadas y cualquier app puede leer datos de las demás, incluidas las del banco.'
          : 'Este teléfono parece estar rooteado: las apps pueden saltarse las protecciones de Android y leer datos de otras apps, incluidas las del banco.',
      advice:
        'Si no fuiste vos, es una señal seria de compromiso. Las apps de home banking no deberían usarse en este equipo.',
    });
  } else if (signals.rooted === false) {
    add(0, {
      code: 'NOT_ROOTED',
      status: 'ok',
      title:
        signals.platform === 'ios'
          ? 'Sin señales de jailbreak'
          : 'Sin señales de root',
      detail: 'Las protecciones del sistema están intactas.',
    });
  }

  // — Depuración USB / opciones de desarrollador (Android) —
  // Solo se reporta lo que se pudo VERIFICAR que está encendido. Si la señal
  // llega `undefined` (el caso normal hoy, ver el comentario del tipo) no se
  // emite ningún chequeo: ni en rojo ni —sobre todo— en verde.
  if (signals.usbDebugging === true) {
    add(15, {
      code: 'USB_DEBUGGING_ON',
      status: 'warning',
      title: 'Depuración USB activada',
      detail:
        'Con la depuración USB activa, una computadora a la que conectes el teléfono puede instalarle apps y leer datos. En un cargador público adulterado, eso es un ataque conocido.',
      advice: 'Si no estás desarrollando apps, desactivala en Opciones de desarrollador.',
      settingsSection: 'developer',
    });
  } else if (signals.developerOptions === true) {
    add(5, {
      code: 'DEVELOPER_OPTIONS_ON',
      status: 'info',
      title: 'Opciones de desarrollador activas',
      detail:
        'No es un riesgo por sí solo, pero abre la puerta a configuraciones sensibles como la depuración USB.',
      advice: 'Si no las usás, desactivalas.',
      settingsSection: 'developer',
    });
  }

  // — Parche de seguridad (Android) —
  if (signals.securityPatch) {
    const ageDays = patchAgeDays(signals.securityPatch, now);
    if (ageDays === null || ageDays < 0) {
      // Fecha ilegible, o "del futuro" porque el reloj del teléfono está mal:
      // no se inventa un veredicto y —sobre todo— no se afirma que está al día.
    } else if (ageDays > PATCH_CRITICAL_DAYS) {
      add(20, {
        code: 'SECURITY_PATCH_STALE',
        status: 'critical',
        title: 'Parche de seguridad muy viejo',
        detail: `La última actualización de seguridad de este teléfono es de hace más de un año (${signals.securityPatch}). Las fallas descubiertas desde entonces quedaron sin arreglar acá.`,
        advice:
          'Buscá actualizaciones del sistema. Si el fabricante ya no las ofrece, tenelo en cuenta: este equipo va quedando expuesto.',
        settingsSection: 'update',
      });
    } else if (ageDays > PATCH_WARNING_DAYS) {
      add(10, {
        code: 'SECURITY_PATCH_OLD',
        status: 'warning',
        title: 'Parche de seguridad atrasado',
        detail: `La última actualización de seguridad es de ${signals.securityPatch}, hace más de seis meses.`,
        advice: 'Revisá si hay una actualización del sistema pendiente.',
        settingsSection: 'update',
      });
    } else {
      add(0, {
        code: 'SECURITY_PATCH_OK',
        status: 'ok',
        title: 'Parches de seguridad al día',
        detail: `Última actualización de seguridad: ${signals.securityPatch}.`,
      });
    }
  }

  // — Servicios de accesibilidad (Android) —
  if (signals.accessibilityServices !== undefined) {
    const unknown = signals.accessibilityServices.filter(
      (service) => !KNOWN_ACCESSIBILITY_PACKAGES.has(accessibilityPackageOf(service)),
    );
    if (unknown.length > 0) {
      add(15, {
        code: 'UNKNOWN_ACCESSIBILITY_SERVICE',
        status: 'warning',
        title: 'Apps con control de accesibilidad',
        detail:
          `Hay ${unknown.length === 1 ? 'una app' : `${unknown.length} apps`} con permiso de accesibilidad: puede leer lo que aparece en pantalla y tocar por vos. Los virus bancarios de la región usan exactamente ese permiso. Si es tu lector de pantalla o una app de asistencia que reconocés, está todo bien.`,
        advice:
          'Entrá a Accesibilidad y revisá la lista: si hay algo que no reconocés, desactivalo y desinstalá esa app.',
        settingsSection: 'accessibility',
      });
    } else {
      add(0, {
        code: 'ACCESSIBILITY_CLEAN',
        status: 'ok',
        title: 'Accesibilidad sin apps extrañas',
        detail: 'Ninguna app desconocida tiene permiso para leer tu pantalla.',
      });
    }
  }

  // — Biometría (suma tranquilidad, no descuenta) —
  if (signals.biometrics === true && signals.screenLock) {
    add(0, {
      code: 'BIOMETRICS_OK',
      status: 'ok',
      title: 'Biometría configurada',
      detail: 'Huella o rostro configurados: desbloqueo rápido sin mostrar tu PIN en público.',
    });
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    checks,
    scannedAt: now.toISOString(),
  };
}

/** Días desde la fecha del parche (YYYY-MM-DD), o null si es ilegible. */
export function patchAgeDays(patch: string, now: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(patch)) return null;
  const then = new Date(`${patch}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}
