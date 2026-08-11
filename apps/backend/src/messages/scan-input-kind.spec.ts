import { scanInputKind } from '@novashield/shared';

/**
 * El ruteo del escáner de la app: un solo token → /v1/analyze, cualquier cosa
 * con espacios → /v1/messages/analyze. Vive en packages/shared y se testea acá
 * porque el workspace de la app no tiene runner de tests.
 *
 * La regla del token único salió de la revisión adversarial: un token que no
 * es un link legible ("https:/ejemplo.com" con la barra comida, "juan@gmail.com")
 * mandado al camino de mensajes volvía como "sin señales" — una tranquilidad
 * falsa sobre algo que no se analizó. El camino de URLs lo analiza si se
 * entiende y si no falla VISIBLE, pidiendo el link completo. Los patrones de
 * estafa necesitan oraciones: sobre un token suelto no aportan nada.
 */
describe('scanInputKind', () => {
  const TOKENS_SUELTOS = [
    'https://ejemplo.com/promo',
    'http://bit.ly/x',
    'HTTPS://EJEMPLO.COM',
    'www.ejemplo.com.ar/promo',
    'bit.ly/premio',
    'mercadolıbre.com.ar', // lookalike unicode: el backend lo pasa a punycode
    'login.002307.com',
    'https:/ejemplo.com', // mal pegado: /v1/analyze responde con el 400 correctivo
    '.ejemplo.com',
    'juan@gmail.com',
    'hola',
    '  https://ejemplo.com  ', // espacios alrededor no lo convierten en mensaje
  ];

  it.each(TOKENS_SUELTOS)('token único → camino de URLs: %s', (text) => {
    expect(scanInputKind(text)).toBe('link');
  });

  const MENSAJES = [
    'Hola pa, cambié de número, transferime al CBU',
    'me pasás el código que te llegó?',
    'Mirá esto https://ejemplo.com/promo', // link + texto: importan las dos señales
    '',
    '   ',
  ];

  it.each(MENSAJES)('con espacios (o vacío) → analizador de mensajes: %s', (text) => {
    expect(scanInputKind(text)).toBe('message');
  });
});
