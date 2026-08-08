import type {
  FamilyAuthResponse,
  FamilyOverview,
  ReportFamilyStatusRequest,
} from '@novashield/shared';
import { API_URL, ApiError } from './api';

/**
 * Cliente del Modo Familia.
 *
 * El token del integrante identifica a ESTE dispositivo dentro de la familia.
 * Lo único que se envía es el resumen de protección (booleanos, contadores y
 * el score): si alguna vez alguien agrega acá un campo con dominios, mensajes
 * o ubicación, está rompiendo la promesa del producto.
 */

async function request<T>(
  path: string,
  init: { method: string; token?: string; body?: unknown },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/family${path}`, {
      method: init.method,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(
      'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.',
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new ApiError(
      message ?? 'No pudimos completar la operación. Probá de nuevo.',
      res.status,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createFamily(
  name: string,
  displayName: string,
): Promise<FamilyAuthResponse> {
  return request('', { method: 'POST', body: { name, displayName } });
}

export function joinFamily(
  inviteCode: string,
  displayName: string,
): Promise<FamilyAuthResponse> {
  return request('/join', { method: 'POST', body: { inviteCode, displayName } });
}

export function fetchFamily(token: string): Promise<FamilyOverview> {
  return request('/me', { method: 'GET', token });
}

export function reportStatus(
  token: string,
  status: ReportFamilyStatusRequest,
): Promise<unknown> {
  return request('/me/status', { method: 'PUT', token, body: status });
}

export function leaveFamily(token: string): Promise<void> {
  return request('/leave', { method: 'POST', token });
}
