/**
 * Utilidades de URL para el motor de análisis: extracción desde texto pegado,
 * normalización, detección de acortadores, guardas anti-SSRF y expansión de
 * redirecciones en el servidor.
 */

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/i;
const BARE_DOMAIN_IN_TEXT =
  /(?:^|[\s:>("'])((?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\.?(?:\/[^\s<>"')\]]*)?)/i;

/** Acortadores conocidos: ocultan el destino real y se expanden server-side. */
export const KNOWN_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  'cutt.ly',
  't.co',
  'is.gd',
  'goo.su',
  'rb.gy',
  'rebrand.ly',
  'shorturl.at',
  'acortar.link',
  'n9.cl',
  's.id',
  'lnkd.in',
  'buff.ly',
  'ow.ly',
  'tiny.cc',
  'qr.ae',
]);

/**
 * Extrae la primera URL del texto que el usuario pegó o compartió.
 * Acepta mensajes completos ("Ganaste! entrá a bit.ly/x") y devuelve la URL
 * con esquema, o null si no hay nada con forma de link.
 */
export function extractUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const withScheme = trimmed.match(URL_IN_TEXT)?.[0];
  if (withScheme) return safeParse(withScheme);

  const bare = trimmed.match(BARE_DOMAIN_IN_TEXT)?.[1];
  if (bare) return safeParse(`https://${bare}`);

  return null;
}

function safeParse(candidate: string): URL | null {
  try {
    const url = new URL(candidate.replace(/[.,;!?]+$/, ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url;
  } catch {
    return null;
  }
}

/** Forma canónica para comparar contra listas: host en minúsculas, sin fragmento. */
export function normalizeForLookup(url: URL): {
  full: string;
  withoutQuery: string;
  host: string;
} {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const path = url.pathname.replace(/\/+$/, '') || '';
  return {
    full: `${host}${path}${url.search}`,
    withoutQuery: `${host}${path}`,
    host,
  };
}

/** Sube por los dominios padres: a.b.c.com → [a.b.c.com, b.c.com, c.com]. */
export function parentDomains(host: string): string[] {
  const parts = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(i).join('.'));
  }
  return out;
}

const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Guarda anti-SSRF para la expansión de redirecciones: nunca seguir destinos
 * hacia hosts internos. Cubre literales; el pinning de DNS queda como TODO
 * para cuando el backend viva en la misma red que otros servicios.
 */
export function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (PRIVATE_V4.test(host)) return true;
  // IPv6 literal (la URL API lo entrega entre corchetes)
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || v6.startsWith('fe80') || /^f[cd]/.test(v6)) return true;
  }
  return false;
}

export interface ExpansionResult {
  finalUrl: URL;
  chain: string[];
}

/**
 * Sigue redirecciones manualmente (máx. `maxHops`) para revelar el destino
 * real de un acortador. HEAD primero y GET como fallback (varios acortadores
 * rechazan HEAD). Cualquier error corta la expansión y devuelve lo recorrido.
 */
export async function expandUrl(
  url: URL,
  maxHops = 5,
  timeoutMsPerHop = 4000,
): Promise<ExpansionResult> {
  let current = url;
  const chain: string[] = [];

  for (let hop = 0; hop < maxHops; hop++) {
    if (isForbiddenHost(current.hostname)) break;

    const location = await fetchLocation(current, timeoutMsPerHop);
    if (!location) break;

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      break;
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') break;
    if (isForbiddenHost(next.hostname)) break;
    if (next.href === current.href) break;

    chain.push(next.href);
    current = next;
  }

  return { finalUrl: current, chain };
}

async function fetchLocation(
  url: URL,
  timeoutMs: number,
): Promise<string | null> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'NovaShield-LinkScanner/0.1' },
      });
      if (res.body) void res.body.cancel();
      if (res.status >= 300 && res.status < 400) {
        return res.headers.get('location');
      }
      if (res.status !== 405 && res.status !== 501) return null;
    } catch {
      return null;
    }
  }
  return null;
}
