import { parseCsvLine, phishTankKeys, validateSourceLoad } from './blocklist.service';

describe('parseCsvLine', () => {
  it('separa campos simples', () => {
    expect(parseCsvLine('1,http://x.com/a,detalle')).toEqual([
      '1',
      'http://x.com/a',
      'detalle',
    ]);
  });

  it('respeta comas dentro de comillas (URLs de PhishTank)', () => {
    expect(parseCsvLine('8,"http://x.com/a,b.html",otro')).toEqual([
      '8',
      'http://x.com/a,b.html',
      'otro',
    ]);
  });

  it('maneja comillas escapadas', () => {
    expect(parseCsvLine('1,"dijo ""hola""",fin')).toEqual([
      '1',
      'dijo "hola"',
      'fin',
    ]);
  });
});

describe('phishTankKeys', () => {
  it('indexa la URL completa con query incluida', () => {
    expect(phishTankKeys('http://malo.com/login?id=1')).toEqual([
      'malo.com/login?id=1',
    ]);
  });

  it('nunca genera la clave del host pelado para un open-redirect', () => {
    // Caso real de PhishTank que marcaba todo google.com como malicioso.
    const keys = phishTankKeys(
      'https://www.google.com/?onboarding=1&url=https://evil.example/',
    );
    expect(keys).not.toContain('www.google.com');
    expect(keys[0].startsWith('www.google.com?')).toBe(true);
  });

  it('descarta entradas malformadas', () => {
    expect(phishTankKeys('no-es-url')).toEqual([]);
  });
});

/**
 * Guarda de carga: antes, un PhishTank en mantenimiento (200 con HTML) se
 * parseaba como 0 URLs y pisaba el último dump bueno sin ningún error, con
 * `isReady` en true porque HaGeZi había cargado. Fail-open real en el escáner.
 */
describe('validateSourceLoad', () => {
  const data = (n: number) => ({
    urls: new Set(Array.from({ length: n }, (_, i) => `u${i}`)),
    domains: new Set<string>(),
  });

  it('rechaza una descarga sin entradas, aunque no haya dato previo', () => {
    expect(validateSourceLoad(data(0), undefined, 0).accept).toBe(false);
  });

  it('acepta la primera carga con datos', () => {
    expect(validateSourceLoad(data(100), undefined, 0).accept).toBe(true);
  });

  it('rechaza una caída a menos de la mitad del dato anterior', () => {
    const check = validateSourceLoad(data(40), data(100), 0);
    expect(check.accept).toBe(false);
    expect(check.reason).toContain('menos de la mitad');
  });

  it('acepta un achicamiento moderado', () => {
    expect(validateSourceLoad(data(60), data(100), 0).accept).toBe(true);
  });

  it('tras tres rechazos seguidos, le cree a la fuente (purga legítima)', () => {
    expect(validateSourceLoad(data(40), data(100), 2).accept).toBe(false);
    expect(validateSourceLoad(data(40), data(100), 3).accept).toBe(true);
  });

  it('cero entradas se rechaza SIEMPRE, sin importar los rechazos previos', () => {
    expect(validateSourceLoad(data(0), data(100), 10).accept).toBe(false);
  });
});
