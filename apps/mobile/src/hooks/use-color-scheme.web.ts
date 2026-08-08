import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * En web el render estático ocurre sin acceso al tema del sistema, así que
 * antes de la hidratación devolvemos 'light' y recién después el valor real.
 * useSyncExternalStore da ese "ya hidraté" sin setState dentro de un efecto
 * (que dispara renders en cascada).
 */
const emptySubscribe = () => () => {};
const getHydrated = () => true;
const getServerHydrated = () => false;

export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    emptySubscribe,
    getHydrated,
    getServerHydrated,
  );
  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
