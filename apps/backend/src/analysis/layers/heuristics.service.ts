import { Injectable } from '@nestjs/common';
import type { AnalysisReason } from '@novashield/shared';
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

/** Marcas más suplantadas en estafas argentinas y sus dominios oficiales. */
const BRANDS: Array<{ token: string; label: string; official: string[] }> = [
  { token: 'mercadopago', label: 'Mercado Pago', official: ['mercadopago.com', 'mercadopago.com.ar'] },
  { token: 'mercadolibre', label: 'Mercado Libre', official: ['mercadolibre.com', 'mercadolibre.com.ar'] },
  { token: 'arca', label: 'ARCA', official: ['arca.gob.ar', 'afip.gob.ar'] },
  { token: 'afip', label: 'AFIP/ARCA', official: ['afip.gob.ar', 'arca.gob.ar'] },
  { token: 'anses', label: 'ANSES', official: ['anses.gob.ar'] },
  { token: 'miargentina', label: 'Mi Argentina', official: ['argentina.gob.ar'] },
  { token: 'galicia', label: 'Banco Galicia', official: ['galicia.ar', 'bancogalicia.com'] },
  { token: 'santander', label: 'Santander', official: ['santander.com.ar', 'santander.com'] },
  { token: 'bbva', label: 'BBVA', official: ['bbva.com.ar', 'bbva.com'] },
  { token: 'macro', label: 'Banco Macro', official: ['macro.com.ar' ] },
  { token: 'banconacion', label: 'Banco Nación', official: ['bna.com.ar'] },
  { token: 'uala', label: 'Ualá', official: ['uala.com.ar', 'uala.com'] },
  { token: 'brubank', label: 'Brubank', official: ['brubank.com'] },
  { token: 'naranjax', label: 'Naranja X', official: ['naranjax.com'] },
  { token: 'whatsapp', label: 'WhatsApp', official: ['whatsapp.com', 'wa.me', 'whatsapp.net'] },
  { token: 'correoargentino', label: 'Correo Argentino', official: ['correoargentino.com.ar'] },
  { token: 'andreani', label: 'Andreani', official: ['andreani.com'] },
  { token: 'edesur', label: 'Edesur', official: ['edesur.com.ar'] },
  { token: 'edenor', label: 'Edenor', official: ['edenor.com.ar'] },
  { token: 'netflix', label: 'Netflix', official: ['netflix.com'] },
];

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
 * ¿La etiqueta de dominio `label` imita a `token`?
 *
 * - Token largo (≥6): una colisión casual es implausible, así que alcanza con
 *   que aparezca como subcadena de la etiqueta desenmascarada
 *   (mercadopagoarg, mercadopag0, mercadopago-seguridad → todos matchean).
 * - Token corto (≤5, como "arca", "macro", "bbva"): se exige que sea una
 *   etiqueta o un segmento separado por guiones completo, no un fragmento de
 *   una palabra más larga — así "marca.com", "macrotrends.com" y "comarca.com"
 *   no disparan un falso positivo.
 */
function labelImitatesToken(label: string, token: string): boolean {
  const compact = unmask(label.replace(/-/g, ''));
  if (token.length >= 6) return compact.includes(token);
  const segments = label.split('-').map(unmask);
  return compact === token || segments.includes(token);
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
    const labels = host.split('.');
    for (const brand of BRANDS) {
      const isOfficial = brand.official.some((official) =>
        parentDomains(host).includes(official),
      );
      if (isOfficial) continue;

      const matches = labels.some((label) => labelImitatesToken(label, brand.token));
      if (matches) return brand;
    }
    return null;
  }
}
