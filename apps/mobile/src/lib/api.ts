import type { AnalyzeResponse } from '@novashield/shared';

/**
 * Cliente del backend de análisis. En desarrollo apunta a localhost; para
 * probar en un dispositivo físico exportar EXPO_PUBLIC_API_URL con la IP de
 * la máquina (p. ej. http://192.168.0.10:3000).
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function analyzeUrl(text: string): Promise<AnalyzeResponse> {
  // AbortController manual: AbortSignal.timeout no está garantizado en Hermes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: text }),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      'No pudimos conectar con el servidor de análisis. Revisá tu conexión e intentá de nuevo.',
    );
  } finally {
    clearTimeout(timer);
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
