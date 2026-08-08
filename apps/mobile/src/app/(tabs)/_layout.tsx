import AppTabs from '@/components/app-tabs';

/**
 * Las cuatro pestañas principales. Dispositivo y Familia NO viven acá: son
 * pantallas de detalle que se apilan encima (ver el Stack de app/_layout.tsx).
 *
 * No alcanzaba con declararlas como triggers `hidden`: expo-router trata un
 * trigger oculto como ruta *protegida* y la deja directamente inalcanzable —
 * `router.navigate('/dispositivo')` no llegaría a ningún lado.
 */
export default function TabsLayout() {
  return <AppTabs />;
}
