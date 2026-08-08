import { readFileSync } from 'node:fs';
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
