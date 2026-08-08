import { matchScamPatterns, normalizeText } from './scam-patterns';

const codes = (text: string) =>
  matchScamPatterns(text).reasons.map((r) => r.code);

describe('normalizeText', () => {
  it('saca tildes y baja a minúsculas', () => {
    expect(normalizeText('CÓDIGO Urgente')).toBe('codigo urgente');
  });

  it('descompone la ñ a n (deliberado: los patrones se escriben así)', () => {
    expect(normalizeText('CONTRASEÑA')).toBe('contrasena');
  });
});

describe('matchScamPatterns · casos reales argentinos', () => {
  it('detecta el pedido del código de WhatsApp (modalidad top)', () => {
    const result = matchScamPatterns(
      'Hola! Te mandé un código por error, me lo pasás porfa?',
    );
    expect(result.reasons.map((r) => r.code)).toContain('WHATSAPP_CODE_REQUEST');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('detecta el cuento del familiar con número nuevo', () => {
    expect(
      codes('Hola pa, cambié de número, este es mi nuevo whatsapp'),
    ).toContain('FAMILY_IMPERSONATION');
  });

  it('detecta pedido de transferencia con CBU', () => {
    expect(
      codes('Necesito que me transfieras a este CBU urgente por favor'),
    ).toContain('TRANSFER_REQUEST');
  });

  it('detecta pedido de clave o token', () => {
    expect(
      codes('Ingresá tu clave de home banking para validar la operación'),
    ).toContain('CREDENTIAL_REQUEST');
  });

  it('detecta amenaza de bloqueo de cuenta', () => {
    expect(
      codes('Su cuenta será bloqueada en 24hs por seguridad'),
    ).toContain('ACCOUNT_BLOCKED');
  });

  it('detecta el anzuelo del premio', () => {
    expect(codes('Felicitaciones! Ganaste un premio de $500.000')).toContain(
      'PRIZE_BAIT',
    );
  });

  it('detecta suplantación de organismo oficial', () => {
    expect(
      codes('ARCA le informa que tiene un reintegro pendiente de acreditar'),
    ).toContain('GOV_IMPERSONATION');
  });

  it('detecta la estafa del paquete retenido', () => {
    expect(
      codes('Su paquete está retenido en aduana, debe abonar la tasa'),
    ).toContain('PACKAGE_FEE');
  });

  it('detecta amenaza de corte de servicio', () => {
    expect(
      codes('EDESUR: corte de suministro programado por deuda impaga'),
    ).toContain('UTILITY_CUTOFF');
  });

  it('detecta oferta de trabajo sospechosa', () => {
    expect(
      codes('Trabajo desde casa, sin experiencia, ganá $80.000 por día'),
    ).toContain('FAKE_JOB');
  });

  it('detecta urgencia fabricada', () => {
    expect(codes('URGENTE: responda antes de hoy')).toContain('URGENCY');
  });

  it('funciona con tildes y mayúsculas', () => {
    expect(codes('SU CUENTA SERÁ BLOQUEADA')).toContain('ACCOUNT_BLOCKED');
  });

  it('acumula varios patrones y topea en 100', () => {
    const result = matchScamPatterns(
      'URGENTE ARCA: su cuenta será bloqueada. Ingresá tu clave y pasame el código que te mandé, después transferí al CBU.',
    );
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    expect(result.score).toBe(100);
  });
});

describe('matchScamPatterns · no dispara con mensajes normales', () => {
  it.each([
    'Hola, ¿cómo andás? ¿Nos vemos mañana a las 8?',
    'Te dejé la factura de luz arriba de la mesa.',
    'Confirmado el turno del médico para el martes.',
    'Feliz cumple!! Que la pases genial hoy 🎉',
    'El pedido llegó bien, gracias!',
    'Che, ¿me pasás la dirección del laburo nuevo?',
  ])('no marca nada en: %s', (text) => {
    expect(matchScamPatterns(text).reasons).toHaveLength(0);
  });

  it('un mensaje bancario informativo sin pedido no dispara credenciales', () => {
    expect(
      codes('Compra aprobada por $12.500 en Supermercado. Consultá en la app.'),
    ).not.toContain('CREDENTIAL_REQUEST');
  });
});
