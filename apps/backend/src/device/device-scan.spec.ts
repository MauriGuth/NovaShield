/**
 * Tests de la lógica del Escáner del Dispositivo (packages/shared/src/device.ts).
 * Viven acá porque packages/shared no tiene runner propio y el backend ya corre
 * jest sobre los tipos compilados del paquete (mismo criterio que domain.spec.ts).
 */
import {
  DeviceSecuritySignals,
  evaluateDeviceSecurity,
  patchAgeDays,
} from '@novashield/shared';

const NOW = new Date('2026-08-08T12:00:00Z');

function androidSignals(over: Partial<DeviceSecuritySignals> = {}): DeviceSecuritySignals {
  return {
    platform: 'android',
    osVersion: '15',
    securityPatch: '2026-07-01',
    screenLock: true,
    biometrics: true,
    rooted: false,
    accessibilityServices: [],
    ...over,
  };
}

const codes = (signals: DeviceSecuritySignals) =>
  evaluateDeviceSecurity(signals, NOW).checks.map((c) => c.code);

describe('evaluateDeviceSecurity', () => {
  it('un teléfono bien configurado saca score alto y todo en ok', () => {
    const result = evaluateDeviceSecurity(androidSignals(), NOW);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('sin bloqueo de pantalla es crítico y golpea fuerte el score', () => {
    const result = evaluateDeviceSecurity(androidSignals({ screenLock: false }), NOW);
    const check = result.checks.find((c) => c.code === 'NO_SCREEN_LOCK');
    expect(check?.status).toBe('critical');
    expect(check?.settingsSection).toBe('security');
    expect(result.score).toBeLessThanOrEqual(70);
  });

  it('root detectado es crítico', () => {
    const result = evaluateDeviceSecurity(androidSignals({ rooted: true }), NOW);
    expect(result.checks.find((c) => c.code === 'ROOT_DETECTED')?.status).toBe('critical');
  });

  it('en iOS el root se llama jailbreak', () => {
    const signals: DeviceSecuritySignals = {
      platform: 'ios',
      osVersion: '18.6',
      screenLock: true,
      rooted: true,
    };
    expect(codes(signals)).toContain('JAILBREAK_DETECTED');
  });

  it('depuración USB pesa más que las opciones de desarrollador solas', () => {
    const usb = evaluateDeviceSecurity(
      androidSignals({ usbDebugging: true, developerOptions: true }),
      NOW,
    );
    const devOnly = evaluateDeviceSecurity(
      androidSignals({ developerOptions: true }),
      NOW,
    );
    expect(usb.score).toBeLessThan(devOnly.score);
    expect(usb.checks.map((c) => c.code)).toContain('USB_DEBUGGING_ON');
    expect(devOnly.checks.map((c) => c.code)).toContain('DEVELOPER_OPTIONS_ON');
  });

  it('sin señal de depuración NO afirma que esté apagada (Android la oculta a las apps)', () => {
    // Settings.Global.ADB_ENABLED devuelve siempre 0 para apps de terceros: no
    // saber no puede leerse como "está todo bien".
    const result = evaluateDeviceSecurity(
      androidSignals({ usbDebugging: undefined, developerOptions: undefined }),
      NOW,
    );
    const emitted = result.checks.map((c) => c.code);
    expect(emitted).not.toContain('DEVELOPER_OPTIONS_OFF');
    expect(emitted).not.toContain('USB_DEBUGGING_ON');
    expect(emitted).not.toContain('DEVELOPER_OPTIONS_ON');
  });

  it('parche de más de un año es crítico; de más de seis meses, warning', () => {
    expect(codes(androidSignals({ securityPatch: '2025-01-01' }))).toContain(
      'SECURITY_PATCH_STALE',
    );
    expect(codes(androidSignals({ securityPatch: '2026-01-01' }))).toContain(
      'SECURITY_PATCH_OLD',
    );
    expect(codes(androidSignals({ securityPatch: '2026-07-15' }))).toContain(
      'SECURITY_PATCH_OK',
    );
  });

  it('un servicio de accesibilidad desconocido genera warning; TalkBack no', () => {
    const withTrojan = androidSignals({
      accessibilityServices: [
        'com.google.android.marvin.talkback/.TalkBackService',
        'com.malware.bancario/com.malware.bancario.Screen',
      ],
    });
    expect(codes(withTrojan)).toContain('UNKNOWN_ACCESSIBILITY_SERVICE');

    const onlyTalkback = androidSignals({
      accessibilityServices: ['com.google.android.marvin.talkback/.TalkBackService'],
    });
    expect(codes(onlyTalkback)).toContain('ACCESSIBILITY_CLEAN');
  });

  it('un troyano NO se blanquea eligiendo un nombre parecido al de Google', () => {
    // El nombre de paquete lo elige el atacante: si comparáramos por prefijo,
    // bastaría llamarse "com.google.android.accessibility.<lo que sea>" para
    // pasar por servicio legítimo.
    for (const impostor of [
      'com.google.android.marvin.talkback.evil/.Spy',
      'com.google.android.accessibility.robo/.Spy',
      'com.samsung.accessibility.fake/.Spy',
    ]) {
      expect(codes(androidSignals({ accessibilityServices: [impostor] }))).toContain(
        'UNKNOWN_ACCESSIBILITY_SERVICE',
      );
    }
  });

  it('el paquete se compara sin la clase y sin importar mayúsculas', () => {
    expect(
      codes(
        androidSignals({
          accessibilityServices: ['COM.GOOGLE.ANDROID.MARVIN.TALKBACK/.TalkBackService'],
        }),
      ),
    ).toContain('ACCESSIBILITY_CLEAN');
  });

  it('un parche con fecha futura (reloj mal) no se declara "al día"', () => {
    const emitted = codes(androidSignals({ securityPatch: '2030-01-01' }));
    expect(emitted).not.toContain('SECURITY_PATCH_OK');
    expect(emitted).not.toContain('SECURITY_PATCH_OLD');
    expect(emitted).not.toContain('SECURITY_PATCH_STALE');
  });

  it('el score nunca baja de 0 ni pasa de 100', () => {
    const worst = evaluateDeviceSecurity(
      androidSignals({
        screenLock: false,
        rooted: true,
        usbDebugging: true,
        developerOptions: true,
        securityPatch: '2020-01-01',
        accessibilityServices: ['com.malware/x'],
      }),
      NOW,
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it('iOS sin señales de Android no genera chequeos de Android', () => {
    const result = evaluateDeviceSecurity(
      { platform: 'ios', osVersion: '18.6', screenLock: true, rooted: false },
      NOW,
    );
    const androidOnly = ['DEVELOPER_OPTIONS_OFF', 'SECURITY_PATCH_OK', 'ACCESSIBILITY_CLEAN'];
    for (const code of androidOnly) {
      expect(result.checks.map((c) => c.code)).not.toContain(code);
    }
  });
});

describe('patchAgeDays', () => {
  it('calcula la edad y rechaza fechas ilegibles', () => {
    expect(patchAgeDays('2026-08-01', NOW)).toBe(7);
    expect(patchAgeDays('no-fecha', NOW)).toBeNull();
    expect(patchAgeDays('2026-13-99', NOW)).toBeNull();
  });
});
