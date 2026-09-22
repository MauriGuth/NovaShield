import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { runBlocklistSync } from '@/lib/blocklist-sync';
import { useSharedText } from '@/lib/use-shared-text';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { sharedText, clearSharedText } = useSharedText();

  // Único punto que consume el share intent: cuando llega un link compartido
  // (WhatsApp, mail, etc.) navegamos al escáner con el texto como parámetro y
  // limpiamos el intent nativo. Así el veredicto se muestra sin importar en
  // qué pestaña abrió la app (en Android abre en Inicio por defecto).
  useEffect(() => {
    if (!sharedText) return;
    router.navigate({ pathname: '/scanner', params: { shared: sharedText } });
    clearSharedText();
  }, [sharedText, clearSharedText]);

  // La lista del escudo se chequea al arrancar y en cada vuelta al frente, no
  // solo al abrir Protección: el escudo protege sobre todo a quien no vuelve a
  // esa pestaña. `runBlocklistSync` decide solo si toca (24 h, backoff tras
  // una falla, recarga desde disco si el proceso se reinició) y no hace nada
  // en builds sin módulo nativo.
  useEffect(() => {
    void runBlocklistSync();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void runBlocklistSync();
    });
    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/*
        Las pestañas son una pantalla del Stack; Dispositivo y Familia se
        apilan encima con su botón de volver. Es la forma de tenerlas
        navegables sin sumar dos íconos más a la barra: seis pestañas se
        vuelven ilegibles, y este producto apunta también a gente mayor.
      */}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="dispositivo" options={{ title: 'Tu dispositivo' }} />
        <Stack.Screen name="familia" options={{ title: 'Modo Familia' }} />
        <Stack.Screen name="planes" options={{ title: 'Planes' }} />
      </Stack>
    </ThemeProvider>
  );
}
