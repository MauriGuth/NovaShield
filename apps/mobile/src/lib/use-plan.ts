import {
  FREE_LIMITS,
  planHas,
  type Capability,
  type PlanTier,
} from '@novashield/shared';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { currentPlan, isBillingAvailable, restore } from './purchases';
import { useShield as useShieldStore } from './store';

/**
 * Plan vigente en este dispositivo.
 *
 * La fuente de verdad es RevenueCat (que a su vez valida contra App Store /
 * Play), no el store local: el plan guardado se usa solo para no parpadear
 * mientras llega la respuesta. Un plan cacheado nunca puede habilitar algo por
 * su cuenta después de que la suscripción venció.
 */
export function usePlan() {
  const storedTier = useShieldStore((s) => s.planTier);
  const setPlanTier = useShieldStore((s) => s.setPlanTier);
  const [tier, setTier] = useState<PlanTier>(storedTier);
  const [loading, setLoading] = useState(isBillingAvailable);

  const refresh = useCallback(async () => {
    if (!isBillingAvailable) return;
    const fresh = await currentPlan();
    setTier(fresh);
    setPlanTier(fresh);
    setLoading(false);
  }, [setPlanTier]);

  // Al montar y cada vez que la app vuelve al frente: la suscripción se puede
  // cancelar o vencer desde fuera de la app (Ajustes de iOS, Play Store), y
  // ahí no llega ningún evento. La consulta va inline y cancelable en vez de
  // llamar a `refresh()`, para no escribir estado sincrónicamente desde el
  // efecto (renders en cascada).
  useEffect(() => {
    if (!isBillingAvailable) return;
    let cancelled = false;

    const load = async () => {
      const fresh = await currentPlan();
      if (cancelled) return;
      setTier(fresh);
      setPlanTier(fresh);
      setLoading(false);
    };

    void load();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [setPlanTier]);

  const restorePurchases = useCallback(async () => {
    const restored = await restore();
    setTier(restored);
    setPlanTier(restored);
    return restored;
  }, [setPlanTier]);

  const can = useCallback(
    (capability: Capability) => planHas(tier, capability),
    [tier],
  );

  return { tier, loading, can, refresh, restorePurchases };
}

/** Cuántos análisis profundos le quedan hoy a un usuario del plan gratuito. */
export function useRemainingAnalyses(tier: PlanTier): number | null {
  const analysesToday = useShieldStore((s) => s.analysesToday);
  const analysesDate = useShieldStore((s) => s.analysesDate);

  if (planHas(tier, 'unlimitedAnalysis')) return null;
  const today = localDateKey();
  const used = analysesDate === today ? analysesToday : 0;
  return Math.max(0, FREE_LIMITS.analysesPerDay - used);
}

/** Fecha local YYYY-MM-DD (el tope se reinicia con el día del usuario). */
export function localDateKey(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
