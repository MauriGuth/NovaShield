import type { FamilyOverview } from '@novashield/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';
import {
  createFamily,
  fetchFamily,
  joinFamily,
  leaveFamily,
  reportStatus,
} from './family-api';
import { getShieldStatus } from './native-shield';
import { useShield as useShieldStore } from './store';

/**
 * Estado del Modo Familia en este dispositivo.
 *
 * El reporte de estado es EXPLÍCITO y acotado: se arma acá, campo por campo,
 * desde el store local. No hay ningún camino por el que un dominio bloqueado o
 * el texto de un mensaje llegue al backend.
 */
export function useFamilyController() {
  const session = useShieldStore((s) => s.family);
  const setFamilySession = useShieldStore((s) => s.setFamilySession);

  const [fetched, setFetched] = useState<FamilyOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si no hay sesión, no hay familia que mostrar: se deriva en vez de
  // sincronizarse con un efecto (así no queda un overview huérfano tras salir).
  const overview = session ? fetched : null;

  const refresh = useCallback(async () => {
    const current = useShieldStore.getState().family;
    // Sin sesión no hay nada que traer: `overview` se deriva de `fetched` más
    // abajo, así que no hace falta (ni conviene) escribir estado acá — un
    // setState sincrónico dispara renders en cascada desde el efecto.
    if (!current) return;

    try {
      const data = await fetchFamily(current.memberToken);
      setFetched(data);
      setError(null);
    } catch (err) {
      // 401 = el integrante ya no existe (salió desde otro lado o lo sacaron):
      // se limpia la sesión local en vez de dejar la pantalla en un limbo.
      if (err instanceof ApiError && err.status === 401) {
        setFamilySession(null);
        setFetched(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'No pudimos actualizar la familia.');
    }
  }, [setFamilySession]);

  // La carga inicial va inline y cancelable, no llamando a `refresh()`: si el
  // integrante sale y entra a otra familia rápido, la respuesta vieja no puede
  // pisar a la nueva.
  const token = session?.memberToken;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchFamily(token);
        if (!cancelled) {
          setFetched(data);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setFamilySession(null);
          setFetched(null);
          return;
        }
        setError(
          err instanceof Error ? err.message : 'No pudimos actualizar la familia.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, setFamilySession]);

  const create = useCallback(
    async (name: string, displayName: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await createFamily(name, displayName);
        setFamilySession({
          familyId: res.family.id,
          memberId: res.memberId,
          memberToken: res.memberToken,
        });
        setFetched(res.family);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No pudimos crear la familia.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [setFamilySession],
  );

  const join = useCallback(
    async (inviteCode: string, displayName: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await joinFamily(inviteCode, displayName);
        setFamilySession({
          familyId: res.family.id,
          memberId: res.memberId,
          memberToken: res.memberToken,
        });
        setFetched(res.family);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No pudimos unirte a la familia.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [setFamilySession],
  );

  const leave = useCallback(async () => {
    const current = useShieldStore.getState().family;
    if (!current) return;
    setBusy(true);
    try {
      await leaveFamily(current.memberToken).catch(() => {
        // Aunque el servidor falle, salimos localmente: el usuario pidió irse.
      });
      setFamilySession(null);
      setFetched(null);
    } finally {
      setBusy(false);
    }
  }, [setFamilySession]);

  /** Envía el resumen de protección. Campo por campo, a propósito. */
  const share = useCallback(async () => {
    const state = useShieldStore.getState();
    if (!state.family) return;

    // El estado del escudo se le pregunta al módulo NATIVO, no al store: el
    // flag persistido dice "el usuario lo activó alguna vez", y el usuario pudo
    // haber apagado la VPN desde Ajustes o haberla perdido ante otra VPN. Si
    // reportáramos el flag, la familia vería "protegido" a alguien que no lo
    // está — el peor error posible en esta pantalla.
    const shieldActive = getShieldStatus() === 'active';

    await reportStatus(state.family.memberToken, {
      shieldActive,
      blocklistUpdatedAt: state.blocklistCheckedAt
        ? new Date(state.blocklistCheckedAt).toISOString()
        : null,
      deviceScanScore: state.deviceScan?.score ?? null,
      blockedCount: state.totalBlocked,
      alertCount: state.alerts.length + state.messageAlerts.length,
    }).catch(() => {
      // Reportar el estado es best-effort: no arruina la pantalla si falla.
    });
    await refresh();
  }, [refresh]);

  return { session, overview, busy, error, create, join, leave, share, refresh };
}
