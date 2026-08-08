import { canonicalDomain, domainLookupKeys } from '@novashield/shared';

/**
 * Estas funciones viven en packages/shared porque el backend genera los
 * prefijos con ellas y el dispositivo consulta con ellas: si divergen, el
 * Escudo DNS deja pasar dominios bloqueados sin ningún error visible.
 */
describe('canonicalDomain', () => {
  it.each([
    ['EJEMPLO.com', 'ejemplo.com'],
    ['ejemplo.com.', 'ejemplo.com'],
    ['  Ejemplo.COM  ', 'ejemplo.com'],
    ['ejemplo.com:8443', 'ejemplo.com'],
    ['sub.Ejemplo.com.', 'sub.ejemplo.com'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalDomain(input)).toBe(expected);
  });

  it('deja los literales IPv6 intactos', () => {
    expect(canonicalDomain('[::1]')).toBe('[::1]');
  });
});

describe('domainLookupKeys', () => {
  it('devuelve el dominio y sus padres, del más específico al más general', () => {
    expect(domainLookupKeys('a.b.ejemplo.com')).toEqual([
      'a.b.ejemplo.com',
      'b.ejemplo.com',
      'ejemplo.com',
    ]);
  });

  it('nunca incluye el TLD solo (no se puede bloquear un TLD entero)', () => {
    expect(domainLookupKeys('ejemplo.com')).toEqual(['ejemplo.com']);
    expect(domainLookupKeys('a.b.c.com')).not.toContain('com');
  });

  it('canonicaliza antes de derivar las claves', () => {
    expect(domainLookupKeys('WWW.Ejemplo.COM.')).toEqual([
      'www.ejemplo.com',
      'ejemplo.com',
    ]);
  });

  it('devuelve vacío para entradas sin punto o IPs literales', () => {
    expect(domainLookupKeys('localhost')).toEqual([]);
    expect(domainLookupKeys('[::1]')).toEqual([]);
    expect(domainLookupKeys('')).toEqual([]);
  });
});
