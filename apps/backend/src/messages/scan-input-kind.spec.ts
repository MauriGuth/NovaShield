import { scanInputKind } from '@novashield/shared';

/**
 * El ruteo del escáner de la app: link suelto → /v1/analyze, todo lo demás →
 * /v1/messages/analyze. Vive en packages/shared y se testea acá porque el
 * workspace de la app no tiene runner de tests.
 *
 * El costo de equivocarse es asimétrico y el sesgo es deliberado: un link
 * clasificado como mensaje se analiza completo igual (el endpoint de mensajes
 * reusa el motor de URLs); un mensaje clasificado como link pierde los
 * patrones de estafa o falla con "no encontramos ningún enlace". Ante la duda,
 * mensaje.
 */
describe('scanInputKind', () => {
  const LINKS = [
    'https://ejemplo.com/promo',
    'http://bit.ly/x',
    'HTTPS://EJEMPLO.COM',
    'www.ejemplo.com.ar/promo',
    'bit.ly/premio',
    'mercadolıbre.com.ar', // lookalike unicode: el backend lo pasa a punycode
    'login.002307.com',
    '  https://ejemplo.com  ', // espacios alrededor no lo convierten en mensaje
  ];

  it.each(LINKS)('link suelto → analizador de URLs: %s', (text) => {
    expect(scanInputKind(text)).toBe('link');
  });

  const MENSAJES = [
    'Hola pa, cambié de número, transferime al CBU',
    'me pasás el código que te llegó?',
    'Mirá esto https://ejemplo.com/promo', // link + texto: importan las dos señales
    'juan@gmail.com', // un mail no es un link
    'hola',
    '',
    '   ',
  ];

  it.each(MENSAJES)('cualquier otra cosa → analizador de mensajes: %s', (text) => {
    expect(scanInputKind(text)).toBe('message');
  });
});
