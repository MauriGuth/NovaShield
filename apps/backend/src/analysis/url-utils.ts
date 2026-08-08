/**
 * Utilidades de URL para el motor de análisis: extracción desde texto pegado,
 * normalización, detección de acortadores, guardas anti-SSRF y expansión de
 * redirecciones en el servidor.
 */

import { assertPublicHost, isForbiddenHost } from './ssrf';

// Re-export para consumidores existentes (tests, servicio).
export { isForbiddenHost } from './ssrf';

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

export interface ExpansionResult {
  finalUrl: URL;
  chain: string[];
}

const MAX_HOPS = 5;
const TIMEOUT_MS_PER_HOP = 3000;
/** Techo de tiempo para TODA la expansión: evita DoS con saltos lentos. */
const TOTAL_BUDGET_MS = 8000;

/**
 * Sigue redirecciones manualmente para revelar el destino real de un
 * acortador. Guardas anti-SSRF por salto (literal + resolución DNS) y
 * presupuesto de tiempo total. Cualquier error o límite corta la expansión y
 * devuelve lo recorrido.
 */
export async function expandUrl(url: URL): Promise<ExpansionResult> {
  let current = url;
  const chain: string[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (isForbiddenHost(current.hostname)) break;
    try {
      await assertPublicHost(current.hostname);
    } catch {
      break;
    }

    const location = await fetchLocation(
      current,
      Math.min(TIMEOUT_MS_PER_HOP, remaining),
    );
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
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'NovaShield-LinkScanner/0.1' },
    });
    if (res.body) void res.body.cancel();
    if (res.status >= 300 && res.status < 400) {
      return res.headers.get('location');
    }
    return null;
  } catch {
    return null;
  }
}
