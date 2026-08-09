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

  /**
   * Estas frases salieron de medir contra el backend en producción: seis de
   * diez formas naturales de pedir un código pasaban como seguras, incluida
   * "me lo reenviás?", que es la más común de todas. Un patrón que solo
   * reconoce la forma en que lo escribiríamos nosotros no sirve de nada.
   */
  describe('el pedido del código, en las formas en que se pide de verdad', () => {
    const PIDEN_EL_CODIGO = [
      'me pasas el codigo que te llego por SMS?',
      'me lo reenvias? es el codigo de 6 digitos',
      'me podes reenviar el codigo de verificacion',
      'reenviame el codigo por favor',
      'me compartis el codigo que te llego?',
      'decime el codigo que te mandaron',
      'copiame el codigo del mensaje',
      'mandame el codigo',
      'necesito el codigo de 6 digitos que te llego',
      'te llego un codigo? necesito que me lo reenvies',
      'pasame el codigo de verificacion urgente',
    ];

    it.each(PIDEN_EL_CODIGO)('detecta: %s', (frase) => {
      expect(codes(frase)).toContain('WHATSAPP_CODE_REQUEST');
    });

    /**
     * La contracara: hay códigos que se comparten todo el tiempo sin ningún
     * riesgo. Marcarlos entrenaría a la gente a ignorar la alerta, y una alerta
     * ignorada no protege de nada.
     */
    const CODIGOS_INOCENTES = [
      'te comparto el codigo de descuento: NOVA20',
      'el codigo de la alarma es 1234',
      'te paso el codigo del wifi',
      'necesito el codigo postal para el envio',
      'te mando el codigo de barras del producto',
      'ya te envie el codigo de referido',
    ];

    it.each(CODIGOS_INOCENTES)('no marca: %s', (frase) => {
      expect(codes(frase)).not.toContain('WHATSAPP_CODE_REQUEST');
    });
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
