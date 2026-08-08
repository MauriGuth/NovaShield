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
