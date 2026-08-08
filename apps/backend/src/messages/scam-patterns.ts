import type { AnalysisReason } from '@novashield/shared';

/**
 * Patrones de estafa por mensaje, calibrados para Argentina.
 *
 * El orden de la lista importa poco (todo suma), pero los pesos sí: el robo de
 * cuenta de WhatsApp mediante el código de verificación es la modalidad top
 * del país, así que pesa por sí sola casi tanto como un dominio en lista negra.
 *
 * Cada patrón se escribe pensando en que su `detail` se le muestra tal cual al
 * usuario: explica por qué es peligroso, no qué regex matcheó.
 */

export interface ScamPattern {
  code: string;
  points: number;
  severity: AnalysisReason['severity'];
  title: string;
  detail: string;
  /** Todas las expresiones son alternativas: con que matchee una, alcanza. */
  patterns: RegExp[];
  /** Patrones que, si aparecen, desactivan la regla (evita falsos positivos). */
  unless?: RegExp[];
}

/**
 * Normaliza para comparar: minúsculas y sin marcas diacríticas. La "ñ" también
 * se descompone a "n" (año → ano, contraseña → contrasena): es deliberado y
 * los patrones se escriben en esa forma, para que un mensaje escrito sin tildes
 * ni eñes —lo habitual en SMS— matchee igual.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // marcas diacríticas combinantes
}

export const SCAM_PATTERNS: ScamPattern[] = [
  {
    code: 'WHATSAPP_CODE_REQUEST',
    points: 80,
    severity: 'critical',
    title: 'Te están pidiendo tu código de verificación',
    detail:
      'Nadie legítimo necesita el código de 6 dígitos que te llega por SMS: con ese código te roban la cuenta de WhatsApp y después le piden plata a tus contactos haciéndose pasar por vos. No lo compartas nunca, ni con alguien que parezca conocido.',
    patterns: [
      /\bcodigo\b[^.!?]{0,40}\b(te (lo )?)?(mand|envi|pas|manda|envia|pasa)/,
      /\b(pas|mand|envi)(a|ame|arme|as)?\b[^.!?]{0,30}\bcodigo\b/,
      /codigo\b[^.!?]{0,30}\b(por error|equivocad)/,
      /\b(6|seis)\s*(digitos|numeros)\b[^.!?]{0,40}\b(pas|mand|envi)/,
      /\bverificacion\b[^.!?]{0,30}\b(pas|mand|envi|decime|deci)/,
    ],
  },
  {
    code: 'FAMILY_IMPERSONATION',
    points: 55,
    severity: 'critical',
    title: 'Posible "cuento del tío" con número nuevo',
    detail:
      'El clásico: alguien dice ser un familiar que cambió de número y enseguida pide plata o una transferencia. Antes de responder, llamá al número viejo de esa persona o preguntale algo que solo ella sepa.',
    patterns: [
      /\b(hola)?\s*(pa|ma|papa|mama|papi|mami|hijo|hija|tio|tia|abuel)\b[^.!?]{0,60}\b(cambie|este es mi (nuevo )?numero|nuevo numero|se me rompio el (celu|telefono))/,
      /\b(cambie|tengo)\b[^.!?]{0,25}\b(de )?numero\b[^.!?]{0,60}\b(necesito|urgente|transfer|plata|pagar|deposit)/,
      /\bsoy\b[^.!?]{0,20}\b(tu|su)\b[^.!?]{0,15}\b(hijo|hija|nieto|nieta|sobrin)\b[^.!?]{0,60}\b(numero|celu|whats)/,
    ],
  },
  {
    code: 'TRANSFER_REQUEST',
    points: 45,
    severity: 'critical',
    title: 'Piden una transferencia o datos bancarios',
    detail:
      'El mensaje pide plata, un CBU/alias o datos de tu cuenta. Verificá siempre por otro canal —llamada o en persona— antes de transferir: una vez enviada, la plata no vuelve.',
    patterns: [
      /\b(cbu|cvu|alias)\b[^.!?]{0,60}\b(transfer|deposit|manda|envi|pas|pag)/,
      /\b(transfer|deposit)(i|ime|ir|encia|as|a)?\b[^.!?]{0,50}\b(cbu|cvu|alias|urgente|ya|ahora)/,
      /\bnecesito\b[^.!?]{0,30}\b(que me (transfieras|deposites|mandes|pases))\b/,
      /\b(numero de )?(tarjeta|cuenta)\b[^.!?]{0,40}\b(codigo de seguridad|cvv|vencimiento|clave)/,
    ],
  },
  {
    code: 'CREDENTIAL_REQUEST',
    points: 60,
    severity: 'critical',
    title: 'Piden tu clave, token o PIN',
    detail:
      'Ningún banco, billetera ni organismo pide claves, tokens ni PIN por mensaje, mail o teléfono. Quien lo hace te está estafando, aunque el mensaje parezca oficial.',
    patterns: [
      /\b(clave|contrasena|password|pin|token|home ?banking)\b[^.!?]{0,50}\b(ingres|confirm|verific|actualiz|envi|pas|deci|valid)/,
      /\b(ingres|confirm|verific|valid)(a|ar|e|ame)?\b[^.!?]{0,40}\b(clave|contrasena|token|pin|datos de tu (cuenta|tarjeta))/,
    ],
  },
  {
    code: 'ACCOUNT_BLOCKED',
    points: 40,
    severity: 'warning',
    title: 'Amenaza de bloqueo de cuenta',
    detail:
      'Decir que tu cuenta será bloqueada o suspendida es la forma más común de apurarte para que no pienses. Si te preocupa, entrá a la app oficial del banco vos mismo, nunca por el link del mensaje.',
    patterns: [
      /\b(cuenta|servicio|acceso|usuario)\b[^.!?]{0,40}\b(bloquead|suspendid|inhabilitad|dad. de baja|sera bloque|se bloque)/,
      /\b(bloque|suspend|inhabilit)(aremos|ada|ado|aran)\b[^.!?]{0,50}\b(cuenta|tarjeta|servicio)/,
      /\b(ultimo aviso|aviso final)\b/,
    ],
  },
  {
    code: 'PRIZE_BAIT',
    points: 40,
    severity: 'warning',
    title: 'Premio o beneficio inesperado',
    detail:
      'Si no participaste de nada, no ganaste nada. Los premios, bonos y reintegros sorpresa son el anzuelo más viejo para que entregues tus datos.',
    patterns: [
      /\b(ganaste|ganador|felicitaciones|felicidades)\b[^.!?]{0,60}\b(premio|sorteo|millon|\$|dinero|regalo|celular|iphone)/,
      /\b(premio|sorteo|bono|reintegro|beneficio)\b[^.!?]{0,50}\b(reclam|retir|cobr|acredit|solicit)/,
      /\bfuiste seleccionad/,
    ],
  },
  {
    code: 'GOV_IMPERSONATION',
    points: 45,
    severity: 'critical',
    title: 'Se hace pasar por un organismo oficial',
    detail:
      'ARCA, ANSES y Mi Argentina no piden datos ni pagos por SMS o WhatsApp. Consultá siempre entrando vos a la página oficial o acercándote a una oficina.',
    patterns: [
      /\b(arca|afip|anses|mi argentina|ministerio|gobierno)\b[^.!?]{0,60}\b(reintegro|bono|credito|deuda|multa|subsidio|acredit|abon|pag)/,
      /\b(anses|arca|afip)\b[^.!?]{0,40}\b(link|ingresa|ingrese|clic|hace clic|actualiz)/,
    ],
  },
  {
    code: 'PACKAGE_FEE',
    points: 40,
    severity: 'warning',
    title: 'Paquete retenido con un pago pendiente',
    detail:
      'La estafa del paquete: dicen que tenés un envío retenido y que pagues una tasa chica. Correo Argentino y las empresas de encomiendas no cobran así por mensaje.',
    patterns: [
      /\b(paquete|envio|encomienda|pedido)\b[^.!?]{0,60}\b(retenid|pendiente|aduana|no pudo ser entregad|abon|pag|tasa|arancel)/,
      /\b(correo argentino|andreani|oca|dhl|fedex)\b[^.!?]{0,60}\b(abon|pag|tasa|retenid|actualiz)/,
    ],
  },
  {
    code: 'UTILITY_CUTOFF',
    points: 35,
    severity: 'warning',
    title: 'Amenaza de corte de servicio',
    detail:
      'Avisan un corte inminente por falta de pago para que pagues apurado por un link. Verificá tu cuenta entrando a la web oficial de la empresa o llamando al número de la factura.',
    patterns: [
      /\b(edesur|edenor|metrogas|aysa|camuzzi|naturgy)\b[^.!?]{0,60}\b(corte|deuda|suspension|abon|pag|vencid)/,
      /\b(corte|suspension)\b[^.!?]{0,40}\b(servicio|suministro)\b[^.!?]{0,40}\b(deuda|falta de pago|hoy|inmediato)/,
    ],
  },
  {
    code: 'FAKE_JOB',
    points: 35,
    severity: 'warning',
    title: 'Oferta de trabajo sospechosa',
    detail:
      'Trabajos que prometen mucha plata por tareas simples desde el celular suelen terminar pidiéndote un depósito inicial o usándote para mover dinero robado.',
    patterns: [
      /\b(trabajo|empleo|puesto|vacante)\b[^.!?]{0,60}\b(desde casa|remoto|medio tiempo|sin experiencia|por dia|diarios|whatsapp)/,
      /\bgana\b[^.!?]{0,25}\b(\$|pesos|usd|dolares)\b[^.!?]{0,30}\b(por dia|diarios|por hora|semanales)/,
    ],
  },
  {
    code: 'URGENCY',
    points: 15,
    severity: 'info',
    title: 'Urgencia fabricada',
    detail:
      'La urgencia es la herramienta principal de la estafa: sirve para que actúes antes de verificar. Un pedido real aguanta que lo confirmes por otro canal.',
    patterns: [
      /\b(urgente|inmediat|ahora mismo|en las proximas|antes de (hoy|las|que)|solo por hoy|ultimas horas|vence hoy)\b/,
      /\b(no compartas este mensaje|no le digas a nadie|es un secreto)\b/,
    ],
  },
];

/** Corre los patrones sobre el texto normalizado. */
export function matchScamPatterns(text: string): {
  score: number;
  reasons: AnalysisReason[];
} {
  const normalized = normalizeText(text);
  const reasons: AnalysisReason[] = [];
  let score = 0;

  for (const pattern of SCAM_PATTERNS) {
    if (pattern.unless?.some((re) => re.test(normalized))) continue;
    if (!pattern.patterns.some((re) => re.test(normalized))) continue;

    score += pattern.points;
    reasons.push({
      code: pattern.code,
      layer: 'heuristics',
      severity: pattern.severity,
      title: pattern.title,
      detail: pattern.detail,
    });
  }

  return { score: Math.min(score, 100), reasons };
}
