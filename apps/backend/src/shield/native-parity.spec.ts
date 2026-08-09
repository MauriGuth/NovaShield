import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Paridad de los archivos nativos duplicados.
 *
 * `ShieldBlocklist.swift` existe DOS veces a propósito:
 *
 *   - `apps/mobile/modules/nova-shield/ios/` — lo compila el pod del módulo,
 *     que es lo que enlaza la app.
 *   - `apps/mobile/targets/_shared/` — lo compilan las extensiones (túnel DNS y
 *     filtro de mensajes), que NO enlazan los pods de Expo.
 *
 * Antes era un symlink, y eso rompía el build: `@bacons/apple-targets` agrega
 * la carpeta del target como file-system synchronized group de Xcode, Xcode
 * resolvía el symlink y arrastraba TODO `modules/nova-shield/ios/` al target de
 * la extensión — incluido `NovaShieldModule.swift`, que importa
 * `ExpoModulesCore`. Resultado: "no such module 'ExpoModulesCore'".
 *
 * Con dos archivos reales el build anda, pero aparece el riesgo de que se
 * separen. Este test lo cierra: si alguien toca uno solo, falla acá y no en
 * producción con el escudo dejando pasar dominios en silencio.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const COPIES = [
  'apps/mobile/modules/nova-shield/ios/ShieldBlocklist.swift',
  'apps/mobile/targets/_shared/ShieldBlocklist.swift',
];

describe('ShieldBlocklist.swift · las dos copias son idénticas', () => {
  it('coinciden byte a byte', () => {
    const [primera, segunda] = COPIES.map((rel) =>
      readFileSync(join(REPO_ROOT, rel), 'utf8'),
    );
    // Si esto falla: copiá la que tocaste sobre la otra.
    // cp apps/mobile/modules/nova-shield/ios/ShieldBlocklist.swift \
    //    apps/mobile/targets/_shared/ShieldBlocklist.swift
    expect(segunda).toBe(primera);
  });

  it('ninguna copia depende de Expo (las extensiones no enlazan sus pods)', () => {
    for (const rel of COPIES) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(source).not.toContain('import ExpoModulesCore');
    }
  });

  it('el podspec NO se llama igual que la app (colisión de schemes)', () => {
    // CocoaPods genera un scheme compartido por cada pod local. Si el pod se
    // llama igual que la app, el workspace queda con dos schemes homónimos y
    // `xcodebuild -scheme NovaShield` puede resolver el del POD: archiva
    // libNovaShield.a, el .xcarchive sale sin ningún .app adentro, las
    // extensiones no se compilan y el export muere con "exportOptionsPlist
    // error for key 'method': expected one {}". Ningún mensaje de esa cadena
    // menciona la palabra "scheme", así que cuesta horas encontrarlo.
    const podspecs = readdirSync(
      join(REPO_ROOT, 'apps/mobile/modules/nova-shield/ios'),
    ).filter((f) => f.endsWith('.podspec'));
    expect(podspecs).toHaveLength(1);

    const source = readFileSync(
      join(REPO_ROOT, 'apps/mobile/modules/nova-shield/ios', podspecs[0]),
      'utf8',
    );
    const podName = /s\.name\s*=\s*'([^']+)'/.exec(source)?.[1];

    const appConfig = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/mobile/app.json'), 'utf8'),
    ) as { expo: { name: string } };
    const schemeName = appConfig.expo.name.replace(/[^A-Za-z0-9]/g, '');

    expect(podName).toBeTruthy();
    expect(podName).not.toBe(schemeName);
  });

  it('el bundle id del túnel en Swift coincide con el que genera apple-targets', () => {
    // @bacons/apple-targets deriva el bundle id del `type` del target, no del
    // `name`. Si el Swift apunta a otro, iOS no encuentra la extensión: no
    // aparece el diálogo de permiso de VPN y el túnel no arranca nunca, sin
    // ningún error que mencione el nombre.
    const targetConfig = readFileSync(
      join(REPO_ROOT, 'apps/mobile/targets/dns-shield/expo-target.config.js'),
      'utf8',
    );
    const type = /type:\s*'([^']+)'/.exec(targetConfig)?.[1];
    expect(type).toBeTruthy();

    const appConfig = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/mobile/app.json'), 'utf8'),
    ) as { expo: { ios: { bundleIdentifier: string } } };

    const expected = `${appConfig.expo.ios.bundleIdentifier}.${type}`;
    const swift = readFileSync(
      join(REPO_ROOT, 'apps/mobile/modules/nova-shield/ios/NovaShieldModule.swift'),
      'utf8',
    );
    const declared = /tunnelBundleId\s*=\s*"([^"]+)"/.exec(swift)?.[1];

    expect(declared).toBe(expected);
  });

  it('los archivos de los targets no importan ExpoModulesCore', () => {
    const targetSources = [
      'apps/mobile/targets/dns-shield/PacketTunnelProvider.swift',
      'apps/mobile/targets/dns-shield/DnsPacketParser.swift',
      'apps/mobile/targets/message-filter/MessageFilterExtension.swift',
    ];
    for (const rel of targetSources) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(source).not.toContain('import ExpoModulesCore');
    }
  });
});

const ANDROID_MODULE = 'apps/mobile/modules/nova-shield/android';

describe('módulo Android · trampas que solo aparecen al compilar', () => {
  it('declara androidx.activity, que expo-modules-core NO expone', () => {
    // `AppContextActivityResultLauncher.launch` recibe un
    // `androidx.activity.result.ActivityResultCallback`, pero expo-modules-core
    // declara esa librería como `implementation`: no llega transitivamente.
    // Sin la dependencia explícita, el diálogo de consentimiento de VPN no
    // compila ("Cannot access class 'ActivityResultCallback'") y el build de
    // EAS muere después de veinte minutos.
    const gradle = readFileSync(
      join(REPO_ROOT, ANDROID_MODULE, 'build.gradle'),
      'utf8',
    );
    expect(gradle).toMatch(/androidx\.activity:activity/);
  });

  it('el namespace del módulo NO es el mismo que el package de la app', () => {
    // El namespace decide dónde se generan BuildConfig y R. Si la librería usa
    // el de la app, las dos generan la misma clase y el build muere recién en
    // `mergeDexRelease` —después de compilar TODO, veinte minutos adentro— con
    // "Type ar.com.novasolutions.novashield.BuildConfig is defined multiple
    // times". Mismo error de fondo que el podspec homónimo en iOS.
    const gradle = readFileSync(
      join(REPO_ROOT, ANDROID_MODULE, 'build.gradle'),
      'utf8',
    );
    const namespace = /namespace\s+"([^"]+)"/.exec(gradle)?.[1];
    expect(namespace).toBeTruthy();

    const appConfig = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/mobile/app.json'), 'utf8'),
    ) as { expo: { android: { package: string } } };

    expect(namespace).not.toBe(appConfig.expo.android.package);
  });

  it('no usa Notification.Builder con canal (existe recién en API 26 y minSdk es 24)', () => {
    // `Notification.Builder(Context, String)` se agregó en Android 8. En un
    // teléfono con Android 7 —que son justo los que más nos importan, gente con
    // equipos viejos— la llamada revienta con NoSuchMethodError al activar el
    // escudo o al avisar de un mensaje peligroso. NotificationCompat hace lo
    // mismo y funciona en las dos.
    const sources = readdirSync(
      join(REPO_ROOT, ANDROID_MODULE, 'src/main/java/ar/com/novasolutions/novashield'),
    ).filter((f) => f.endsWith('.kt'));

    for (const file of sources) {
      const source = readFileSync(
        join(REPO_ROOT, ANDROID_MODULE, 'src/main/java/ar/com/novasolutions/novashield', file),
        'utf8',
      );
      expect(source).not.toMatch(/[^t]Notification\.Builder\(/);
    }
  });

  it('el perfil de EAS para probar en un teléfono produce un APK, no un AAB', () => {
    // Un .aab no se instala en un teléfono: es el formato que se sube a Play.
    // Sin esto, el build "sale bien" y el archivo no sirve para nada.
    const eas = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/mobile/eas.json'), 'utf8'),
    ) as {
      build: Record<string, { distribution?: string; android?: { buildType?: string } }>;
    };

    for (const [name, profile] of Object.entries(eas.build)) {
      if (profile.distribution !== 'internal') continue;
      expect([name, profile.android?.buildType]).toEqual([name, 'apk']);
    }
  });
});
