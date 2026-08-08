/**
 * expo-router llama a esto para cada deep link entrante antes de rutear.
 * La share extension de iOS abre la app con una URL tipo
 * `novashield://dataUrl=novashieldShareKey?...` que no matchea ninguna ruta y
 * caería en "Unmatched Route". La redirigimos al escáner, que lee el texto
 * compartido vía expo-share-intent y muestra el veredicto.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes('dataUrl=') || path.includes('ShareKey')) {
    return '/scanner';
  }
  return path;
}
