import { HeuristicsService } from './heuristics.service';

describe('HeuristicsService', () => {
  const service = new HeuristicsService();
  const analyze = (url: string, shortened = false) =>
    service.analyze(new URL(url), shortened);

  it('no marca nada en un dominio oficial limpio', () => {
    const result = analyze('https://www.mercadopago.com.ar/ayuda');
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it('detecta imitación de marca en dominio no oficial', () => {
    const result = analyze('https://mercadopago-premios.top/login');
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain('BRAND_IMPERSONATION');
    expect(codes).toContain('SUSPICIOUS_TLD');
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it('detecta camuflaje con caracteres parecidos (mercad0pago)', () => {
    const result = analyze('https://mercad0pago.com/verificar');
    expect(result.reasons.map((r) => r.code)).toContain('BRAND_IMPERSONATION');
  });

  it('no confunde el subdominio oficial con imitación', () => {
    const result = analyze('https://auth.mercadopago.com.ar/');
    expect(result.reasons.map((r) => r.code)).not.toContain(
      'BRAND_IMPERSONATION',
    );
  });

  it.each([
    'https://www.marca.com/futbol', // diario deportivo — contiene "arca"
    'https://www.macrotrends.net/', // finanzas — contiene "macro"
    'https://comarca-turismo.com.ar/', // contiene "arca"
    'https://barca-fans.com/', // contiene "arca"
  ])('no marca imitación por subcadena en %s', (url) => {
    expect(analyze(url).reasons.map((r) => r.code)).not.toContain(
      'BRAND_IMPERSONATION',
    );
  });

  it.each([
    'https://arca-tramites.top/acceso', // token corto como segmento
    'https://macro-seguridad.top/login', // token corto como segmento
    'https://mercadopagoarg.com/pago', // token largo sin guiones
  ])('sí marca imitación real en %s', (url) => {
    expect(analyze(url).reasons.map((r) => r.code)).toContain(
      'BRAND_IMPERSONATION',
    );
  });

  it('marca acortadores', () => {
    const result = analyze('https://bit.ly/premi0-arg');
    expect(result.reasons.map((r) => r.code)).toContain('SHORTENED_URL');
  });

  it('marca punycode como crítico', () => {
    const result = analyze('https://xn--mercadopgo-c6a.com/');
    const reason = result.reasons.find((r) => r.code === 'PUNYCODE_HOST');
    expect(reason?.severity).toBe('critical');
  });

  it('marca host con IP', () => {
    const result = analyze('http://45.13.22.10/banco/login');
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain('IP_HOST');
    expect(codes).toContain('NO_TLS');
  });

  it('marca el truco del @ en la URL', () => {
    const result = analyze('https://santander.com.ar@evil.example/login');
    expect(result.reasons.map((r) => r.code)).toContain('USERINFO_TRICK');
  });

  it('marca palabras de urgencia/premio en el path', () => {
    const result = analyze('https://sitio-cualquiera.com/ganaste-premio');
    expect(result.reasons.map((r) => r.code)).toContain('URGENCY_KEYWORD');
  });

  it('el score acumulado nunca supera 100', () => {
    const result = analyze(
      'http://mercad0pago-arg-premio.top/ganaste?verificar=1',
      true,
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
