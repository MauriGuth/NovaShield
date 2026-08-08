/**
 * Puente con expo-share-intent (recibir links desde el menú Compartir).
 * El módulo nativo solo existe en development builds / builds de EAS; en Expo
 * Go el require falla y la app sigue funcionando sin la función de compartir.
 */

type ShareIntentModule = typeof import('expo-share-intent');

let shareIntent: ShareIntentModule | null = null;
try {
  shareIntent = require('expo-share-intent') as ShareIntentModule;
} catch {
  shareIntent = null;
}

export interface SharedText {
  sharedText: string | null;
  clearSharedText: () => void;
}

export function useSharedText(): SharedText {
  // La presencia del módulo es constante durante toda la vida del proceso,
  // así que el orden de hooks no cambia entre renders.
  if (!shareIntent) {
    return { sharedText: null, clearSharedText: () => {} };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { hasShareIntent, shareIntent: intent, resetShareIntent } =
    shareIntent.useShareIntent();

  const sharedText = hasShareIntent
    ? (intent?.webUrl ?? intent?.text ?? null)
    : null;

  return { sharedText, clearSharedText: resetShareIntent };
}
