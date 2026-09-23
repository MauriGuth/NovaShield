/**
 * Veredictos de la prueba del escudo (código de la APP: apps/mobile/src/lib/shield-test.ts).
 *
 * La prueba abre en el navegador una página del dominio de prueba y compara
 * los contadores del túnel antes y después. Cada veredicto manda a la persona
 * a tocar un lugar distinto del teléfono: confundirlos es mandarla a arreglar
 * lo que no está roto.
 */
import { SHIELD_TEST_DOMAIN } from '@novashield/shared';
import {
  describeShieldTest,
  judgeShieldTest,
  shieldTestUrl,
  type ShieldTestVerdict,
} from '../../../mobile/src/lib/shield-test';

const at = (testHits: number, queries: number) => ({ testHits, queries });

describe('prueba del escudo · veredicto', () => {
  it('la consulta de prueba llegó al túnel → funciona', () => {
    expect(judgeShieldTest('active', at(0, 40), at(3, 55))).toBe('passed');
  });

  it('el túnel recibió consultas pero no la de prueba → el navegador resuelve por su cuenta', () => {
    expect(judgeShieldTest('active', at(2, 40), at(2, 47))).toBe('browser_bypass');
  });

  it('el túnel no recibió nada → el teléfono no le manda consultas', () => {
    expect(judgeShieldTest('active', at(0, 40), at(0, 40))).toBe('no_traffic');
  });

  it('si el túnel se rearmó en el medio, el contador que baja cuenta desde cero', () => {
    expect(judgeShieldTest('active', at(5, 900), at(1, 3))).toBe('passed');
    expect(judgeShieldTest('active', at(0, 900), at(0, 3))).toBe('browser_bypass');
  });

  it('escudo apagado o esquivado por el DNS privado: se dice eso, no que el navegador falla', () => {
    expect(judgeShieldTest('inactive', at(0, 0), at(0, 0))).toBe('not_active');
    expect(judgeShieldTest('preempted', at(0, 0), at(0, 0))).toBe('not_active');
    expect(judgeShieldTest('bypassed', at(0, 10), at(0, 20))).toBe('bypassed');
  });

  it('la URL de prueba usa el dominio reservado con una etiqueta al azar', () => {
    expect(shieldTestUrl('ab12cd')).toBe(`https://ab12cd.${SHIELD_TEST_DOMAIN}/`);
    expect(SHIELD_TEST_DOMAIN.endsWith('.test')).toBe(true);
  });

  it('cada veredicto tiene texto en las dos plataformas, y solo "passed" es verde', () => {
    const verdicts: ShieldTestVerdict[] = ['passed', 'not_active', 'bypassed', 'browser_bypass', 'no_traffic'];
    for (const platform of ['ios', 'android'] as const) {
      for (const verdict of verdicts) {
        const copy = describeShieldTest(verdict, platform);
        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.ok).toBe(verdict === 'passed');
        if (!copy.ok && verdict !== 'not_active') expect(copy.steps).toBeTruthy();
      }
    }
    expect(describeShieldTest('browser_bypass', 'ios').steps).toMatch(/Retransmisión privada/);
    expect(describeShieldTest('browser_bypass', 'android').steps).toMatch(/Usar DNS seguro/);
  });
});
