/**
 * Marcas que se suplantan en estafas argentinas y sus dominios oficiales.
 *
 * Vive en shared porque la usan el motor de URLs, los patrones de mensajes
 * y —más adelante— el teléfono. Dos reglas de matching que están en el
 * backend (heuristics.service.ts) y hay que respetar al agregar entradas:
 *
 * - Token largo (≥6 letras) sin `exact`: matchea como SUBCADENA de la etiqueta
 *   desenmascarada. Solo para nombres que no aparecen dentro de otras palabras
 *   (mercadopago, brubank, andreani). "amazon" NO califica: amazonia.com.
 * - `exact: true` (y todo token ≤5 letras): matchea solo como etiqueta o
 *   segmento completo ("modo-pagos"), o pegado a una palabra de contexto
 *   bancario ("ansesbonos", "bancomacro"). Para nombres que también son
 *   palabras o lugares: nación, galicia, naranja, personal, claro, apple.
 *
 * Solo se listan como `official` dominios que la marca controla de verdad.
 * Listar uno que no existe abriría la puerta a que un atacante lo registre y
 * pase por oficial.
 */
export interface Brand {
  token: string;
  label: string;
  official: readonly string[];
  exact?: boolean;
}

export const BRANDS: readonly Brand[] = [
  // — Billeteras y pagos —
  { token: 'mercadopago', label: 'Mercado Pago', official: ['mercadopago.com', 'mercadopago.com.ar', 'mercadopago.com.mx', 'mercadopago.com.br', 'mercadopago.cl', 'mercadopago.com.co', 'mercadopago.com.uy', 'mercadopago.com.pe', 'mercadolibre.com'] },
  { token: 'mercadolibre', label: 'Mercado Libre', official: ['mercadolibre.com', 'mercadolibre.com.ar', 'mercadolibre.com.mx', 'mercadolibre.cl', 'mercadolibre.com.co', 'mercadolibre.com.uy', 'mercadolibre.com.pe', 'mercadolibre.com.ve', 'mercadolibre.com.ec', 'mercadolibre.com.bo', 'mercadolibre.com.py', 'mercadolivre.com.br', 'mlstatic.com'] },
  { token: 'mercadolivre', label: 'Mercado Livre', official: ['mercadolivre.com.br', 'mercadolibre.com'] },
  { token: 'uala', label: 'Ualá', official: ['uala.com.ar', 'uala.com', 'uala.com.mx', 'uala.co'], exact: true },
  { token: 'brubank', label: 'Brubank', official: ['brubank.com'] },
  { token: 'naranjax', label: 'Naranja X', official: ['naranjax.com', 'naranja.com'] },
  { token: 'naranja', label: 'Naranja X', official: ['naranjax.com', 'naranja.com'], exact: true },
  { token: 'personalpay', label: 'Personal Pay', official: ['personalpay.com.ar', 'personal.com.ar'] },
  { token: 'cuentadni', label: 'Cuenta DNI', official: ['cuentadni.com.ar', 'bancoprovincia.com.ar'] },
  { token: 'modo', label: 'MODO', official: ['modo.com.ar'], exact: true },
  { token: 'prex', label: 'Prex', official: ['prexcard.com'], exact: true },
  { token: 'lemon', label: 'Lemon', official: ['lemon.me'], exact: true },
  { token: 'belo', label: 'Belo', official: ['belo.app'], exact: true },
  { token: 'astropay', label: 'AstroPay', official: ['astropay.com'] },
  { token: 'paypal', label: 'PayPal', official: ['paypal.com', 'paypal.me'] },
  { token: 'binance', label: 'Binance', official: ['binance.com'] },

  // — Bancos —
  { token: 'galicia', label: 'Banco Galicia', official: ['galicia.ar', 'bancogalicia.com', 'bancogalicia.com.ar'], exact: true },
  { token: 'bancogalicia', label: 'Banco Galicia', official: ['galicia.ar', 'bancogalicia.com', 'bancogalicia.com.ar'] },
  { token: 'santander', label: 'Santander', official: ['santander.com.ar', 'santanderrio.com.ar', 'santander.com', 'santander.cl', 'santander.com.mx', 'santander.com.br', 'santander.com.uy', 'bancosantander.es'] },
  { token: 'bbva', label: 'BBVA', official: ['bbva.com.ar', 'bbva.com', 'bbva.es', 'bbva.mx', 'bbva.pe', 'bbva.com.co', 'bbva.cl', 'bbva.com.uy'] },
  { token: 'macro', label: 'Banco Macro', official: ['macro.com.ar', 'bancomacro.com.ar'], exact: true },
  { token: 'bancomacro', label: 'Banco Macro', official: ['macro.com.ar', 'bancomacro.com.ar'] },
  { token: 'banconacion', label: 'Banco Nación', official: ['bna.com.ar'] },
  { token: 'nacion', label: 'Banco Nación', official: ['bna.com.ar'], exact: true },
  { token: 'bna', label: 'Banco Nación', official: ['bna.com.ar'], exact: true },
  { token: 'bancoprovincia', label: 'Banco Provincia', official: ['bancoprovincia.com.ar', 'provincianet.com.ar', 'cuentadni.com.ar'] },
  { token: 'bancociudad', label: 'Banco Ciudad', official: ['bancociudad.com.ar'] },
  { token: 'icbc', label: 'ICBC', official: ['icbc.com.ar', 'icbc.com.cn'], exact: true },
  { token: 'hsbc', label: 'HSBC', official: ['hsbc.com.ar', 'hsbc.com', 'hsbc.co.uk'], exact: true },
  { token: 'supervielle', label: 'Banco Supervielle', official: ['supervielle.com.ar'] },
  { token: 'bancopatagonia', label: 'Banco Patagonia', official: ['bancopatagonia.com.ar'] },
  { token: 'credicoop', label: 'Banco Credicoop', official: ['bancocredicoop.coop'] },
  { token: 'hipotecario', label: 'Banco Hipotecario', official: ['hipotecario.com.ar'] },
  { token: 'itau', label: 'Itaú', official: ['itau.com.ar', 'itau.com.br', 'itau.com.uy', 'itau.com'], exact: true },
  { token: 'comafi', label: 'Banco Comafi', official: ['comafi.com.ar'] },
  { token: 'bancosantafe', label: 'Banco Santa Fe', official: ['bancosantafe.com.ar'] },
  { token: 'bancor', label: 'Bancor', official: ['bancor.com.ar'], exact: true },
  { token: 'openbank', label: 'Openbank', official: ['openbank.com.ar', 'openbank.es'] },

  // — Organismos —
  { token: 'arca', label: 'ARCA', official: ['arca.gob.ar', 'afip.gob.ar'], exact: true },
  { token: 'afip', label: 'AFIP/ARCA', official: ['afip.gob.ar', 'arca.gob.ar'], exact: true },
  { token: 'anses', label: 'ANSES', official: ['anses.gob.ar', 'anses.gov.ar'], exact: true },
  { token: 'miargentina', label: 'Mi Argentina', official: ['argentina.gob.ar'] },
  { token: 'pami', label: 'PAMI', official: ['pami.org.ar'], exact: true },
  { token: 'bcra', label: 'BCRA', official: ['bcra.gob.ar'], exact: true },
  { token: 'veraz', label: 'Veraz', official: ['veraz.com.ar'], exact: true },
  { token: 'renaper', label: 'RENAPER', official: ['argentina.gob.ar'] },

  // — Telcos y servicios —
  { token: 'personal', label: 'Personal', official: ['personal.com.ar', 'personalpay.com.ar'], exact: true },
  { token: 'movistar', label: 'Movistar', official: ['movistar.com.ar', 'movistar.com', 'movistar.es', 'movistar.com.mx', 'movistar.cl', 'movistar.com.pe', 'movistar.com.uy'] },
  { token: 'claro', label: 'Claro', official: ['claro.com.ar', 'claro.com', 'claro.com.br', 'claro.cl', 'claro.com.co', 'claro.com.pe', 'claro.com.uy', 'claro.com.py'], exact: true },
  { token: 'edesur', label: 'Edesur', official: ['edesur.com.ar'] },
  { token: 'edenor', label: 'Edenor', official: ['edenor.com'] },
  { token: 'metrogas', label: 'Metrogas', official: ['metrogas.com.ar'] },
  { token: 'aysa', label: 'AySA', official: ['aysa.com.ar'], exact: true },
  { token: 'camuzzi', label: 'Camuzzi', official: ['camuzzigas.com.ar'] },
  { token: 'naturgy', label: 'Naturgy', official: ['naturgy.com.ar', 'naturgy.com'] },

  // — Logística —
  { token: 'correoargentino', label: 'Correo Argentino', official: ['correoargentino.com.ar'] },
  { token: 'andreani', label: 'Andreani', official: ['andreani.com'] },
  { token: 'oca', label: 'OCA', official: ['oca.com.ar'], exact: true },
  { token: 'dhl', label: 'DHL', official: ['dhl.com'], exact: true },
  { token: 'fedex', label: 'FedEx', official: ['fedex.com'], exact: true },

  // — Cuentas y plataformas (la llave maestra del resto) —
  { token: 'whatsapp', label: 'WhatsApp', official: ['whatsapp.com', 'wa.me', 'whatsapp.net'] },
  { token: 'instagram', label: 'Instagram', official: ['instagram.com', 'cdninstagram.com'] },
  { token: 'facebook', label: 'Facebook', official: ['facebook.com', 'fb.com', 'fb.me', 'fbcdn.net', 'meta.com', 'messenger.com'] },
  { token: 'telegram', label: 'Telegram', official: ['telegram.org', 't.me', 'telegram.me'] },
  { token: 'tiktok', label: 'TikTok', official: ['tiktok.com'] },
  { token: 'google', label: 'Google', official: ['google.com', 'google.com.ar', 'googleapis.com', 'googleusercontent.com', 'goo.gl', 'withgoogle.com', 'gmail.com', 'youtube.com', 'google.co'], exact: true },
  { token: 'gmail', label: 'Gmail', official: ['gmail.com', 'google.com'], exact: true },
  { token: 'apple', label: 'Apple', official: ['apple.com', 'icloud.com', 'apple.com.ar'], exact: true },
  { token: 'icloud', label: 'iCloud', official: ['icloud.com', 'apple.com'], exact: true },
  { token: 'microsoft', label: 'Microsoft', official: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com', 'msn.com'], exact: true },
  { token: 'outlook', label: 'Outlook', official: ['outlook.com', 'live.com', 'office.com', 'microsoft.com'], exact: true },
  { token: 'amazon', label: 'Amazon', official: ['amazon.com', 'amazon.com.mx', 'amazon.com.br', 'amazon.es', 'amazonaws.com', 'primevideo.com'], exact: true },
  { token: 'netflix', label: 'Netflix', official: ['netflix.com'] },
  { token: 'spotify', label: 'Spotify', official: ['spotify.com'] },
  { token: 'despegar', label: 'Despegar', official: ['despegar.com', 'despegar.com.ar'] },
  { token: 'aerolineas', label: 'Aerolíneas Argentinas', official: ['aerolineas.com.ar'] },
  { token: 'rappi', label: 'Rappi', official: ['rappi.com', 'rappi.com.ar'], exact: true },
  { token: 'pedidosya', label: 'PedidosYa', official: ['pedidosya.com', 'pedidosya.com.ar'] },
  { token: 'ypf', label: 'YPF', official: ['ypf.com'], exact: true },
];

/**
 * Palabras que, pegadas a una marca `exact`, delatan la imitación:
 * "ansesbonos", "bancomacro", "ualaayuda", "galiciaonline". Se aceptan también
 * en plural.
 */
export const BRAND_CONTEXT_WORDS: ReadonlySet<string> = new Set([
  'banco', 'home', 'homebanking', 'banking', 'online', 'cliente', 'clientes',
  'ingreso', 'ingresar', 'cuenta', 'cuentas', 'token', 'clave', 'claves',
  'bono', 'bonos', 'pago', 'pagos', 'promo', 'promos', 'tramite', 'tramites',
  'turno', 'turnos', 'app', 'ar', 'arg', 'argentina', 'oficial', 'ayuda',
  'soporte', 'seguridad', 'verificacion', 'verificar', 'acceso', 'login',
  'credito', 'creditos', 'prestamo', 'prestamos', 'beneficio', 'beneficios',
  'reintegro', 'reintegros', 'mi', 'tu', 'web', 'movil', 'digital', 'premio',
  'premios', 'sorteo', 'sorteos', 'id', 'cuentadni', 'wallet', 'billetera',
  'pay', 'plus', 'bloqueo', 'bloqueado', 'suspendido', 'aviso', 'alerta',
]);
