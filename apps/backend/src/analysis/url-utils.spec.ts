import {
  extractUrl,
  extractUrls,
  normalizeForLookup,
  parentDomains,
} from './url-utils';
import { isForbiddenHost, isPrivateIp } from './ssrf';

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

  it('extrae dominios lookalike con letras unicode (los pasa a punycode)', () => {
    // La ı turca imita a la i: el lookalike clásico de mercadolibre. Con la
    // clase ASCII vieja, este dominio pegado sin esquema devolvía null.
    const url = extractUrl('mercadolıbre.com.ar');
    expect(url?.hostname).toBe('xn--mercadolbre-6zb.com.ar');
  });

  it('un token que ES un dominio acepta lookalike unicode de dos etiquetas', () => {
    // Pegado solo en el escáner no hay prosa que confunda: se analiza aunque
    // tenga solo dos etiquetas (dentro de un texto se exigen tres).
    const url = extractUrl('bancoestаdo.cl'); // а cirílica
    expect(url?.hostname).toBe('xn--bancoestdo-6qi.cl');
  });

  it('no confunde dos palabras pegadas por un punto con un dominio', () => {
    // La última etiqueta (el TLD) tiene que ser ASCII: "Traé" no lo es.
    expect(extractUrl('nos vemos mañana.Traé el mate')).toBeNull();
  });
});

describe('extractUrls (mensajes con varios links)', () => {
  it('extrae el lookalike unicode dentro de un mensaje', () => {
    const urls = extractUrls(
      'Tu cuenta fue suspendida, entrá a mercadolıbre.com.ar y validá',
    );
    expect(urls.map((u) => u.hostname)).toContain(
      'xn--mercadolbre-6zb.com.ar',
    );
  });

  it('NO fabrica dominios con el chat rioplatense sin espacio tras el punto', () => {
    // "mañana.te" tiene solo dos etiquetas: el candidato unicode exige tres.
    // Sin esta regla, un mensaje inocente disparaba la señal crítica de
    // punycode sobre un xn--… fantasma (hallazgo de la revisión adversarial).
    for (const texto of [
      'nos vemos mañana.te aviso cualquier cosa',
      'llegó al país.hay que ir a buscarlo',
      'qué lindo día.vamos a la plaza',
      'mañana.me avisás',
    ]) {
      expect(extractUrls(texto)).toHaveLength(0);
    }
  });

  it('el dominio ASCII pegado a una letra unicode se extrae igual', () => {
    // Los linkificadores de los chats descartan el carácter raro final: la
    // víctima puede llegar al sitio, así que el análisis también tiene que
    // llegar. El borde de palabra aplica SOLO a candidatos unicode.
    const urls = extractUrls('Entrá a validar tu cuenta en bancofalso.comа urgente');
    expect(urls.map((u) => u.hostname)).toContain('bancofalso.com');
  });

  it('con URL completa presente, no duplica con dominios pelados', () => {
    const urls = extractUrls('https://ejemplo.com y también ejemplo.com');
    expect(urls).toHaveLength(1);
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
    '100.64.0.1',
    'servicio.internal',
    // Literales IPv6 que evadían la guarda vieja (SSRF a metadata/localhost):
    '[::1]',
    '[::]',
    '[::ffff:169.254.169.254]',
    '[::ffff:127.0.0.1]',
    '[fe80::1]',
    '[fc00::1]',
    '[fd12:3456::1]',
  ])('bloquea %s', (host) => {
    expect(isForbiddenHost(host)).toBe(true);
  });

  it.each(['google.com', '8.8.8.8', 'mercadopago.com.ar', '[2001:4860:4860::8888]'])(
    'permite %s',
    (host) => {
      expect(isForbiddenHost(host)).toBe(false);
    },
  );
});

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.0.1',
    '172.20.0.1',
    '100.100.0.1',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    'fe80::1',
    'fc00::1',
  ])('marca %s como privada', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '200.42.0.1', '2001:4860:4860::8888'])(
    'marca %s como pública',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );
});
