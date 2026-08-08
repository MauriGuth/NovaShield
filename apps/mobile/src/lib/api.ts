import type {
  AnalyzeMessageRequest,
  AnalyzeMessageResponse,
  AnalyzeResponse,
} from '@novashield/shared';

/**
 * Cliente del backend de análisis. En desarrollo apunta a localhost; para
 * probar en un dispositivo físico exportar EXPO_PUBLIC_API_URL con la IP de
 * la máquina (p. ej. http://192.168.0.10:3000).
 */
// La URL del backend se inlinea en tiempo de build. En producción DEBE venir
// de EXPO_PUBLIC_API_URL (https); el fallback a localhost es solo para dev.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? 'http://localhost:3000' : '');

if (!API_URL) {
  // Falla temprano y visible en builds de producción sin la variable, en vez
  // de mostrarle al usuario un engañoso "revisá tu conexión" en cada análisis.
  throw new Error(
    'EXPO_PUBLIC_API_URL no está configurada. Definila (https://…) antes de generar el build.',
  );
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function analyzeUrl(
  text: string,
  signal?: AbortSignal,
): Promise<AnalyzeResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: text }),
      signal,
    });
  } catch (err) {
    // Propagamos aborts para que la pantalla los distinga de un error de red.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(
      'No pudimos conectar con el servidor de análisis. Revisá tu conexión e intentá de nuevo.',
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message[0]
      : body?.message;
    throw new ApiError(
      message ?? 'El análisis falló. Probá de nuevo en unos segundos.',
      res.status,
    );
  }

  return (await res.json()) as AnalyzeResponse;
}

/** Analiza el texto de un mensaje (SMS, notificación o pegado a mano). */
export async function analyzeMessage(
  input: AnalyzeMessageRequest,
  signal?: AbortSignal,
): Promise<AnalyzeMessageResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/messages/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(
      'No pudimos conectar con el servidor de análisis. Revisá tu conexión e intentá de nuevo.',
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new ApiError(
      message ?? 'El análisis falló. Probá de nuevo en unos segundos.',
      res.status,
    );
  }

  return (await res.json()) as AnalyzeMessageResponse;
}
