import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
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
      </Stack>
    </ThemeProvider>
  );
}
