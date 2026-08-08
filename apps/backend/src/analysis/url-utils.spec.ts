import {
  extractUrl,
  isForbiddenHost,
  normalizeForLookup,
  parentDomains,
} from './url-utils';

describe('extractUrl', () => {
  it('extrae una URL con esquema desde texto pegado', () => {
    const url = extractUrl(
      '¡Ganaste $500.000! Reclamá tu premio acá 👉 https://bit.ly/premi0-arg',
    );
    expect(url?.href).toBe('https://bit.ly/premi0-arg');
  });

  it('acepta dominios sin esquema y les agrega https', () => {
    const url = extractUrl('entrá a www.ejemplo.com.ar/promo ya!');
    expect(url?.href).toBe('https://www.ejemplo.com.ar/promo');
  });

  it('descarta puntuación colgante al final del link', () => {
    const url = extractUrl('mirá https://ejemplo.com/pagina.');
    expect(url?.href).toBe('https://ejemplo.com/pagina');
  });

  it('devuelve null si no hay nada con forma de link', () => {
    expect(extractUrl('hola, ¿cómo estás?')).toBeNull();
    expect(extractUrl('')).toBeNull();
  });

  it('rechaza esquemas que no sean http/https', () => {
    expect(extractUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('normalizeForLookup', () => {
  it('baja a minúsculas el host y quita la barra final', () => {
    const { full, withoutQuery, host } = normalizeForLookup(
      new URL('https://EJEMPLO.com/Path/?q=1'),
    );
    expect(host).toBe('ejemplo.com');
    expect(withoutQuery).toBe('ejemplo.com/Path');
    expect(full).toBe('ejemplo.com/Path?q=1');
  });
});

describe('parentDomains', () => {
  it('recorre los dominios padres sin incluir el TLD solo', () => {
    expect(parentDomains('a.b.ejemplo.com')).toEqual([
      'a.b.ejemplo.com',
      'b.ejemplo.com',
      'ejemplo.com',
    ]);
  });
});

describe('isForbiddenHost', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    'servicio.internal',
  ])('bloquea %s', (host) => {
    expect(isForbiddenHost(host)).toBe(true);
  });

  it.each(['google.com', '8.8.8.8', 'mercadopago.com.ar'])(
    'permite %s',
    (host) => {
      expect(isForbiddenHost(host)).toBe(false);
    },
  );
});
