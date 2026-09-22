import { Injectable } from '@nestjs/common';
import {
  BRAND_CONTEXT_WORDS,
  BRANDS,
  type AnalysisReason,
  type Brand,
} from '@novashield/shared';
import { KNOWN_SHORTENERS, parentDomains } from '../url-utils';

/**
 * Capa 3a · Heurísticas.
 *
 * Reglas que detectan señales típicas del fraude sin depender de servicios
 * externos: acortadores, punycode, imitación de marcas argentinas, TLDs
 * baratos, urgencia fabricada. Cada razón se escribe en lenguaje simple
 * porque se muestra tal cual al usuario (principio del producto: cada alerta
 * educa).
 */

export interface HeuristicsResult {
  score: number;
  reasons: AnalysisReason[];
}

/** TLDs con alta proporción de abuso y costo casi nulo de registro. */
const SUSPICIOUS_TLDS = new Set([
  'zip', 'top', 'icu', 'click', 'rest', 'gq', 'tk', 'ml', 'cf', 'ga',
  'work', 'loan', 'cam', 'monster', 'quest', 'sbs', 'cfd', 'bond',
]);

const URGENCY_KEYWORDS = [
  'premio', 'ganaste', 'gratis', 'bono', 'sorteo', 'urgente', 'verificar',
  'verifica', 'bloqueado', 'bloqueada', 'suspendido', 'actualizar-datos',
  'actualiza', 'regalo', 'reintegro', 'devolucion',
];

/**
 * ¿La etiqueta de dominio `label` imita a la marca?
 *
 * - Token largo sin `exact`: alcanza con que aparezca como subcadena de la
 *   etiqueta desenmascarada (mercadopagoarg, mercadopag0, mercadopago-seguridad).
 * - Token `exact` (o corto, ≤5): tiene que ser una etiqueta o un segmento
 *   completo ("modo-pagos"), o venir PEGADO a una palabra de contexto bancario
 *   ("ansesbonos", "bancomacro", "ualaayuda", "galiciaonline"). Así
 *   lanacion.com.ar, comodo.com, patagonia.com y personalidad.com quedan
 *   afuera, y bancomacro.com o ansesbonos.com adentro.
 */
function labelImitatesBrand(label: string, brand: Brand): boolean {
  const compact = unmask(label.replace(/-/g, ''));
  const segments = label.split('-').map(unmask);
  const { token } = brand;

  if (compact === token || segments.includes(token)) return true;
  if (!brand.exact && token.length >= 6) return compact.includes(token);
  return segments.some((segment) => attachedToContext(segment, token));
}

function attachedToContext(segment: string, token: string): boolean {
  if (segment.length <= token.length) return false;
  if (segment.startsWith(token)) return isContextWord(segment.slice(token.length));
  if (segment.endsWith(token)) {
    return isContextWord(segment.slice(0, segment.length - token.length));
  }
  return false;
}

function isContextWord(word: string): boolean {
  if (BRAND_CONTEXT_WORDS.has(word)) return true;
  return word.endsWith('s') && BRAND_CONTEXT_WORDS.has(word.slice(0, -1));
}

/** Sustituciones típicas de caracteres parecidos para camuflar una marca. */
function unmask(text: string): string {
  return text
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/vv/g, 'w')
    .replace(/rn/g, 'm');
}

@Injectable()
export class HeuristicsService {
  analyze(url: URL, wasShortened: boolean): HeuristicsResult {
    const reasons: AnalysisReason[] = [];
    let score = 0;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const add = (
      points: number,
      code: string,
      severity: AnalysisReason['severity'],
      title: string,
      detail: string,
    ) => {
      score += points;
      reasons.push({ code, layer: 'heuristics', severity, title, detail });
    };

    if (wasShortened || KNOWN_SHORTENERS.has(host)) {
      add(
        15,
        'SHORTENED_URL',
        'warning',
        'Enlace acortado',
        'El link usa un acortador que oculta el destino real. Los bancos y organismos oficiales no piden datos a través de links acortados.',
      );
    }

    if (host.startsWith('xn--') || host.includes('.xn--')) {
      add(
        35,
        'PUNYCODE_HOST',
        'critical',
        'Dominio con caracteres engañosos',
        'El dominio usa caracteres especiales que imitan letras comunes. Es una técnica típica para hacerse pasar por un sitio conocido.',
      );
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
      add(
        30,
        'IP_HOST',
        'critical',
        'Dirección IP en lugar de dominio',
        'El link apunta a una dirección numérica en vez de un nombre de sitio. Los sitios legítimos casi nunca se comparten así.',
      );
    }

    if (url.username) {
      add(
        35,
        'USERINFO_TRICK',
        'critical',
        'Dirección disfrazada',
        'El link contiene un "@" que esconde el destino verdadero: lo que aparece antes del @ es decorativo y el navegador va a lo que está después.',
      );
    }

    if (url.protocol === 'http:') {
      add(
        10,
        'NO_TLS',
        'warning',
        'Conexión sin cifrar',
        'El sitio no usa HTTPS. Cualquier dato que cargues ahí puede ser leído por terceros.',
      );
    }

    const tld = host.split('.').pop() ?? '';
    if (SUSPICIOUS_TLDS.has(tld)) {
      add(
        10,
        'SUSPICIOUS_TLD',
        'warning',
        'Terminación de dominio poco confiable',
        `Los dominios ".${tld}" son gratuitos o muy baratos y se usan mucho en campañas de estafa. No es prueba de fraude, pero suma sospecha.`,
      );
    }

    const brandHit = this.detectBrandImpersonation(host);
    if (brandHit) {
      add(
        40,
        'BRAND_IMPERSONATION',
        'critical',
        `Se hace pasar por ${brandHit.label}`,
        `El dominio menciona a ${brandHit.label} pero no es el sitio oficial (${brandHit.official[0]}). Es la técnica más común del phishing: parecerse al original.`,
      );
    }

    if (host.split('.').length >= 5) {
      add(
        5,
        'EXCESSIVE_SUBDOMAINS',
        'info',
        'Demasiados subdominios',
        'El dominio tiene una cadena larga de subdominios, algo que se usa para esconder el dominio real al final.',
      );
    }

    if ((host.match(/-/g)?.length ?? 0) >= 3) {
      add(
        5,
        'HYPHENATED_HOST',
        'info',
        'Dominio con muchos guiones',
        'Los dominios con varios guiones suelen ser registros descartables creados para una campaña puntual.',
      );
    }

    const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();
    const keyword = URGENCY_KEYWORDS.find((k) => pathAndQuery.includes(k));
    if (keyword) {
      add(
        10,
        'URGENCY_KEYWORD',
        'warning',
        'Lenguaje de urgencia o premio',
        `El link contiene "${keyword}". Los premios inesperados y las urgencias fabricadas son el gancho clásico de las estafas.`,
      );
    }

    return { score: Math.min(score, 100), reasons };
  }

  private detectBrandImpersonation(host: string) {
    // Se compara por ETIQUETAS de dominio, no por subcadena cruda del host
    // entero: un `includes('arca')` marcaba marca.com o comarca.com.ar, y
    // `includes('macro')` marcaba macrotrends.com. Una imitación real inserta
    // la marca como una etiqueta (o combinada con separadores) — p. ej.
    // "mercadopago-premios.top" o "mercadopag0.com" —, no como fragmento de
    // una palabra más larga y no relacionada.
    // La última etiqueta (el TLD) queda afuera: un TLD de marca (.google,
    // .bbva, .apple) solo puede tenerlo la marca, así que "blog.google" es de
    // Google y no una imitación.
    const labels = host.split('.').slice(0, -1);
    for (const brand of BRANDS) {
      const isOfficial = brand.official.some((official) =>
        parentDomains(host).includes(official),
      );
      if (isOfficial) continue;

      const matches = labels.some((label) => labelImitatesBrand(label, brand));
      if (matches) return brand;
    }
    return null;
  }
}
