import { SHIELD_TEST_DOMAIN, type ShieldStatus } from '@novashield/shared';

/**
 * Prueba del escudo en el teléfono real.
 *
 * Revisar el código no alcanza para saber si el escudo protege: el túnel
 * puede funcionar perfecto y aun así no ver nada, porque el navegador usa su
 * propio DNS cifrado, porque iCloud manda Safari por la Retransmisión privada,
 * o porque el sistema tiene un DNS privado fijo. Desde afuera todas se ven
 * igual ("abrí el sitio y cargó"), y cada una se arregla en un lugar distinto.
 *
 * La prueba abre en el navegador una página del dominio de prueba (que no
 * existe: `.test` no se puede registrar) y compara los contadores del túnel
 * antes y después:
 *   - `testHits` subió → el navegador le preguntó al escudo y lo frenó.
 *   - no subió, pero `queries` sí → el túnel recibe consultas del teléfono,
 *     pero no las del navegador: el navegador resuelve por su cuenta.
 *   - no subió nada → el teléfono no le está mandando consultas al túnel.
 *
 * Se hace desde el navegador y no desde la app a propósito: en Android la app
 * está excluida del túnel (ver DnsShieldVpnService), y lo que hay que medir es
 * lo que vive la persona cuando toca un link.
 */

export interface TunnelCounters {
  testHits: number;
  queries: number;
}

export type ShieldTestVerdict =
  | 'passed'
  | 'not_active'
  | 'bypassed'
  | 'browser_bypass'
  | 'no_traffic';

/** URL de prueba con una etiqueta al azar: ninguna caché puede contestar por el escudo. */
export function shieldTestUrl(nonce: string): string {
  return `https://${nonce}.${SHIELD_TEST_DOMAIN}/`;
}

/** Los contadores del túnel se reinician si el túnel se rearma: una baja cuenta desde cero. */
function grew(before: number, after: number): number {
  return after >= before ? after - before : after;
}

export function judgeShieldTest(
  status: ShieldStatus,
  before: TunnelCounters,
  after: TunnelCounters,
): ShieldTestVerdict {
  if (grew(before.testHits, after.testHits) > 0) return 'passed';
  if (status === 'bypassed') return 'bypassed';
  if (status !== 'active') return 'not_active';
  if (grew(before.queries, after.queries) > 0) return 'browser_bypass';
  return 'no_traffic';
}

export interface VerdictCopy {
  title: string;
  detail: string;
  steps?: string;
  ok: boolean;
}

/** Textos para la persona, por plataforma. Cada uno dice qué pasó y dónde tocar. */
export function describeShieldTest(
  verdict: ShieldTestVerdict,
  platform: 'ios' | 'android',
): VerdictCopy {
  const ios = platform === 'ios';
  switch (verdict) {
    case 'passed':
      return {
        ok: true,
        title: 'Funciona: el escudo frenó la página de prueba',
        detail:
          'Tu navegador le pregunta al escudo antes de abrir cada sitio. Si además te llegó el aviso "La prueba del escudo funcionó", las notificaciones también andan.',
      };
    case 'not_active':
      return {
        ok: false,
        title: 'Primero prendé el escudo',
        detail:
          'La prueba mide si el escudo frena páginas. Con el escudo apagado no hay nada que medir.',
      };
    case 'bypassed':
      return {
        ok: false,
        title: 'El DNS privado del teléfono esquiva el escudo',
        detail:
          'Tu teléfono tiene un DNS privado con servidor fijo y manda las consultas cifradas por fuera del escudo.',
        steps:
          'Ajustes → Conexiones → Más ajustes de conexión → DNS privado → Automático.\nEn otros teléfonos: Ajustes → Red e internet → DNS privado.',
      };
    case 'browser_bypass':
      return ios
        ? {
            ok: false,
            title: 'Safari no le preguntó al escudo',
            detail:
              'El escudo recibe las consultas del iPhone, pero Safari resolvió la página de prueba por otro lado. Casi siempre es la Retransmisión privada de iCloud.',
            steps:
              'Ajustes → tocá tu nombre → iCloud → Retransmisión privada → apagala.\nSi usás otro navegador, buscá "DNS seguro" en su configuración y apagalo.\nDespués cerrá el navegador del todo y volvé a probar.',
          }
        : {
            ok: false,
            title: 'Tu navegador no le preguntó al escudo',
            detail:
              'El escudo recibe consultas del teléfono, pero el navegador resolvió la página de prueba por su cuenta, con su propio DNS cifrado.',
            steps:
              'En Chrome: menú ⋮ → Configuración → Privacidad y seguridad → Usar DNS seguro → apagalo, o elegí "Con tu proveedor de servicios actual".\nEn otros navegadores, buscá "DNS seguro" en la configuración y apagalo.\nDespués cerrá el navegador del todo y volvé a probar.',
          };
    case 'no_traffic':
      return ios
        ? {
            ok: false,
            title: 'El escudo no recibió ninguna consulta',
            detail:
              'Está prendido, pero el iPhone no le mandó ni una consulta mientras probabas.',
            steps:
              'Ajustes → General → VPN y administración de dispositivos: que no haya otra VPN ni un perfil de DNS instalado.\nDespués apagá y prendé el escudo, y volvé a probar.',
          }
        : {
            ok: false,
            title: 'El escudo no recibió ninguna consulta',
            detail:
              'Está prendido, pero el teléfono no le mandó ni una consulta mientras probabas.',
            steps:
              'Ajustes → Conexiones → Más ajustes de conexión → DNS privado → Automático (en otros teléfonos: Ajustes → Red e internet → DNS privado).\nFijate que no haya otra VPN prendida.\nDespués apagá y prendé el escudo, y volvé a probar.',
          };
  }
}
