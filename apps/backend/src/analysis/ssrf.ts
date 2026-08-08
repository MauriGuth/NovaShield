import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';

/**
 * Guardas anti-SSRF para la expansión de redirecciones de acortadores.
 *
 * Defensa en dos niveles:
 *  1. `isForbiddenHost` bloquea literales privados (IPv4, IPv6 y — clave — el
 *     rango IPv4-mapeado ::ffff:0:0/96 y la dirección sin especificar ::).
 *  2. `assertPublicHost` resuelve el hostname y rechaza si CUALQUIER dirección
 *     cae en rango privado (cierra el SSRF por registro DNS estático, p. ej.
 *     evil.example con A → 169.254.169.254).
 *
 * Residual conocido: DNS rebinding con TTL bajo (la IP validada acá podría
 * diferir de la que resuelve el fetch real). Cerrarlo requiere pinnear la
 * conexión a la IP validada (undici custom dispatcher) — TODO para cuando el
 * backend viva junto a otros servicios internos.
 */

/** ¿Una IP (v4 o v6, en cualquier forma) apunta a un recurso interno? */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');

  if (isIPv4(addr)) return isPrivateV4(addr);

  // IPv4-mapeado / -compatible: extraer la IPv4 embebida y validarla.
  const mapped = extractMappedV4(addr);
  if (mapped) return isPrivateV4(mapped);

  return isPrivateV6(addr);
}

function isPrivateV4(addr: string): boolean {
  const p = addr.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // forma inválida: tratar como no confiable
  }
  const [a, b] = p;
  if (a === 0 || a === 127 || a >= 224) return true; // this-host, loopback, multicast/reservado
  if (a === 10) return true;
  if (a === 169 && b === 254) return true; // link-local (incluye metadata cloud)
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && p[2] === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return false;
}

/** Extrae la IPv4 de `::ffff:1.2.3.4` o `::ffff:a9fe:a9fe` (hex). */
function extractMappedV4(addr: string): string | null {
  const dotted = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

function isPrivateV6(addr: string): boolean {
  if (addr === '::' || addr === '::1') return true; // unspecified, loopback
  if (addr.startsWith('fe80') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (/^f[cd]/.test(addr)) return true; // ULA fc00::/7
  return false;
}

/**
 * Guarda sincrónica sobre el literal del host (sin resolver DNS). Cubre el
 * caso en que el host de la redirección ya es una IP o un nombre reservado.
 */
export function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;

  // Literal IPv6 entre corchetes.
  if (host.startsWith('[')) return isPrivateIp(host);
  // Literal IPv4.
  if (isIPv4(host)) return isPrivateV4(host);

  return false;
}

/**
 * Resuelve el hostname y lanza si alguna dirección es privada. No-op para
 * literales (ya cubiertos por isForbiddenHost) que fallan la resolución.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    // No resuelve: el fetch fallará solo; no lo tratamos como amenaza.
    return;
  }
  const blocked = addresses.find((a) => isPrivateIp(a.address));
  if (blocked) {
    throw new Error(
      `SSRF bloqueado: ${hostname} resuelve a dirección interna ${blocked.address}`,
    );
  }
}
