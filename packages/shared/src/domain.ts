/**
 * Canonicalización de dominios para el Escudo DNS.
 *
 * CRÍTICO: el backend genera los prefijos de hash con estas mismas funciones y
 * el dispositivo los consulta con ellas. Cualquier divergencia entre ambos
 * lados hace que el escudo deje pasar dominios bloqueados sin ningún error
 * visible — por eso viven acá y no duplicadas en cada app.
 */

/**
 * Forma canónica de un host: minúsculas, sin punto final, sin puerto.
 *
 * NO se saca el `www.` inicial, a propósito. Sacarlo acá indexaría una entrada
 * `www.evil.com` de la lista como `evil.com` y bloquearía el apex entero —
 * falso positivo caro. El caso legítimo ya lo cubre `domainLookupKeys()`, que
 * al consultar `www.ejemplo.com` prueba también `ejemplo.com`.
 */
export function canonicalDomain(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h; // literal IPv6: se deja tal cual
  h = h.replace(/\.+$/, '');
  const colon = h.lastIndexOf(':');
  if (colon > 0 && /^[0-9]+$/.test(h.slice(colon + 1))) h = h.slice(0, colon);
  return h;
}

/**
 * Claves a consultar para un host: el dominio y todos sus padres, de más
 * específico a más general. Bloquear `ejemplo.com` bloquea `a.b.ejemplo.com`,
 * que es lo que espera cualquier lista de dominios.
 *
 * No incluye el TLD solo (`com`) para no poder bloquear un TLD entero por accidente.
 */
export function domainLookupKeys(host: string): string[] {
  const canonical = canonicalDomain(host);
  if (!canonical || canonical.startsWith('[')) return [];

  const parts = canonical.split('.');
  if (parts.length < 2) return [];

  const keys: string[] = [];
  for (let i = 0; i <= parts.length - 2; i++) {
    keys.push(parts.slice(i).join('.'));
  }
  return keys;
}
