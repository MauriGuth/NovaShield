import type { ShieldStatus } from '@novashield/shared';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { syncBlocklist, type SyncResult } from './blocklist-sync';
import { NovaShield, getShieldStatus } from './native-shield';
import { useShield as useShieldStore } from './store';

/**
 * Estado vivo del Escudo DNS. El estado real lo manda el sistema operativo
 * (el usuario puede apagar la VPN desde Ajustes o instalar otra que tome el
 * túnel), así que la fuente de verdad es el módulo nativo y no el store: acá
 * se escuchan sus eventos y se refleja lo que efectivamente está pasando.
 */
export function useShieldController() {
  const [status, setStatus] = useState<ShieldStatus>(() => getShieldStatus());
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  /** Motivo por el que falló la última activación, para mostrarlo en pantalla. */
  const [error, setError] = useState<string | null>(null);

  const setShieldEnabled = useShieldStore((s) => s.setShieldEnabled);
  const recordBlockedDomain = useShieldStore((s) => s.recordBlockedDomain);
  const recordBlocklistSync = useShieldStore((s) => s.recordBlocklistSync);
  const syncNativeBlocks = useShieldStore((s) => s.syncNativeBlocks);

  // Eventos del módulo nativo, más un refresco cada vez que la app vuelve al
  // frente: el usuario pudo haber apagado la VPN desde Ajustes mientras estaba
  // afuera, y ahí no llega ningún evento.
  useEffect(() => {
    if (!NovaShield) return;

    const statusSub = NovaShield.addListener('onStatusChange', (event) => {
      setStatus(event.status);
      setShieldEnabled(event.status === 'active');
    });
    const blockedSub = NovaShield.addListener('onDomainBlocked', (event) => {
      recordBlockedDomain(event.domain, event.at);
    });
    // En iOS los bloqueos los cuenta la extensión, en otro proceso: no puede
    // emitir `onDomainBlocked`, así que la app tiene que ir a buscarlos. Sin
    // esto el contador quedaba en cero para siempre aunque el escudo estuviera
    // bloqueando — el usuario no se enteraba nunca de que lo protegimos.
    const pullNativeBlocks = () => {
      const events = NovaShield?.getBlockedEvents?.();
      if (events) syncNativeBlocks(events);
    };
    pullNativeBlocks();
    const pull = setInterval(pullNativeBlocks, 5000);

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setStatus(getShieldStatus());
        pullNativeBlocks();
      }
    });

    return () => {
      clearInterval(pull);
      statusSub.remove();
      blockedSub.remove();
      appStateSub.remove();
    };
  }, [recordBlockedDomain, setShieldEnabled, syncNativeBlocks]);

  const sync = useCallback(
    async (options: { force?: boolean } = {}) => {
      // El estado de sync se lee acá adentro y no con selectores del hook: si
      // fuera dependencia del callback, cada `recordBlocklistSync` re-crearía
      // `sync` y el efecto de montaje de la pantalla lo volvería a disparar,
      // en loop.
      const snapshot = useShieldStore.getState();
      const result = await syncBlocklist(
        {
          version: snapshot.blocklistVersion,
          lastCheckedAt: snapshot.blocklistCheckedAt,
        },
        options,
      );
      // Solo `updated`/`up-to-date` son chequeos reales contra el servidor.
      // Registrar un `skipped` como chequeo movería la fecha sin haber
      // consultado nada y el refresco semanal no se dispararía nunca.
      if (
        (result.status === 'updated' || result.status === 'up-to-date') &&
        result.version
      ) {
        recordBlocklistSync({
          version: result.version,
          domainCount:
            result.domainCount ?? snapshot.blocklistDomainCount ?? 0,
        });
      }
      setLastSync(result);
      return result;
    },
    [recordBlocklistSync],
  );

  const enable = useCallback(async () => {
    if (!NovaShield || busy) return;
    setBusy(true);
    setError(null);
    try {
      // La lista tiene que estar cargada ANTES de levantar el túnel: si no, el
      // escudo dejaría pasar todo durante los primeros segundos.
      await sync();

      // Se pide junto con el escudo y no en el arranque de la app: acá el
      // usuario ya entendió para qué sirve, así que el permiso tiene sentido.
      // Si lo rechaza, el escudo funciona igual — solo pierde el aviso.
      await NovaShield.requestNotificationPermission?.().catch(() => false);

      const granted = await NovaShield.requestPermission();
      if (!granted) {
        setStatus(NovaShield.getStatus());
        setError('Necesitamos tu permiso para activar el escudo. Probá de nuevo y aceptá el aviso del sistema.');
        return;
      }
      await NovaShield.start();
      setStatus(NovaShield.getStatus());
      setShieldEnabled(true);
    } catch (err) {
      // Sin este catch el error se perdía: el switch volvía solo a apagado y no
      // aparecía NADA en pantalla. En una app de seguridad eso es lo peor que
      // puede pasar — el usuario se queda pensando que está protegido, o que la
      // app está rota, sin forma de saber cuál de las dos.
      setStatus(NovaShield.getStatus());
      setError(
        err instanceof Error
          ? `No pudimos activar el escudo: ${err.message}`
          : 'No pudimos activar el escudo. Probá de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, sync, setShieldEnabled]);

  const disable = useCallback(async () => {
    if (!NovaShield || busy) return;
    setBusy(true);
    try {
      await NovaShield.stop();
      setStatus(NovaShield.getStatus());
      setShieldEnabled(false);
    } finally {
      setBusy(false);
    }
  }, [busy, setShieldEnabled]);

  return { status, busy, lastSync, error, enable, disable, sync };
}

/** Texto de estado listo para mostrar, por plataforma y situación. */
export function describeStatus(status: ShieldStatus): {
  label: string;
  detail: string;
} {
  switch (status) {
    case 'active':
      return {
        label: 'Escudo activo',
        detail:
          'Estamos filtrando los dominios de estafa conocidos en todas las apps del teléfono.',
      };
    case 'inactive':
      return {
        label: 'Escudo apagado',
        detail:
          'Activalo para bloquear los sitios de estafa antes de que carguen, sin importar desde qué app venga el link.',
      };
    case 'preempted':
      return {
        label: 'Protección pausada',
        detail:
          'Otra VPN o perfil DNS está activo y tiene prioridad sobre el escudo. Desactivala para que Nova Shield vuelva a protegerte.',
      };
    case 'needs_permission':
      return {
        label: 'Falta un paso',
        detail:
          'Tenés que habilitar el escudo a mano en los Ajustes del teléfono. Te llevamos hasta ahí.',
      };
    default:
      return {
        label: 'No disponible en este build',
        detail:
          'El Escudo DNS necesita la app instalada desde una build nativa. En Expo Go no está disponible.',
      };
  }
}
