import { parseCsvLine, phishTankKeys } from './blocklist.service';

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
