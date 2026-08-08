import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Capa 2 · Verificación autoritativa con Google Web Risk (Lookup API).
 *
 * Web Risk es la variante comercial de Safe Browsing (que prohíbe uso
 * comercial). Gratis hasta 100k consultas/mes; por eso: caché en memoria con
 * TTL y deduplicación por URL. Se activa solo si WEB_RISK_API_KEY está
 * configurada — sin clave, la capa se reporta como no ejecutada.
 */

const ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search';
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 10_000;

interface CacheEntry {
  threatTypes: string[] | null;
  expiresAt: number;
}

@Injectable()
export class WebRiskService {
  private readonly logger = new Logger(WebRiskService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: ConfigService) {}

  get isEnabled(): boolean {
    return Boolean(this.config.get<string>('WEB_RISK_API_KEY'));
  }

  /**
   * Devuelve los tipos de amenaza detectados, [] si está limpio, o null si la
   * capa no pudo ejecutarse (deshabilitada o error de red).
   */
  async check(url: URL): Promise<string[] | null> {
    if (!this.isEnabled) return null;

    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.threatTypes;

    try {
      const params = new URLSearchParams();
      params.set('key', this.config.get<string>('WEB_RISK_API_KEY')!);
      params.set('uri', url.href);
      for (const t of THREAT_TYPES) params.append('threatTypes', t);

      const res = await fetch(`${ENDPOINT}?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`Web Risk respondió HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        threat?: { threatTypes?: string[]; expireTime?: string };
      };
      const threatTypes = body.threat?.threatTypes ?? [];
      const expiresAt = body.threat?.expireTime
        ? new Date(body.threat.expireTime).getTime()
        : Date.now() + CACHE_TTL_MS;

      if (this.cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
      this.cache.set(key, { threatTypes, expiresAt });
      return threatTypes;
    } catch (err) {
      this.logger.warn(`Error consultando Web Risk: ${err}`);
      return null;
    }
  }
}
