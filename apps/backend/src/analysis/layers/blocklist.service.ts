import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { domainLookupKeys } from '@novashield/shared';
import { normalizeForLookup } from '../url-utils';

/**
 * Capa 1 · Bases de amenazas.
 *
 * Fuentes elegidas por licencia apta para uso comercial (ver
 * docs/decisiones-tecnicas.md): PhishTank (dump CSV), HaGeZi TIF (GPL,
 * server-side OK) y URLhaus (requiere Auth-Key gratuita de abuse.ch).
 * Explícitamente excluidas: Google Safe Browsing, VirusTotal free,
 * OpenPhish Community y Phishing Army (licencias no comerciales).
 *
 * Todo vive en memoria y se refresca cada 2 horas; si una fuente falla se
 * conserva su último dato bueno.
 */

export interface BlocklistHit {
  source: string;
  kind: 'url' | 'domain';
}

interface SourceData {
  urls: Set<string>;
  domains: Set<string>;
  loadedAt: Date;
}

const PHISHTANK_URL = 'https://data.phishtank.com/data/online-valid.csv';
const HAGEZI_TIF_MINI_URL =
  'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/tif.mini.txt';
const URLHAUS_HOSTFILE_URL = 'https://urlhaus.abuse.ch/downloads/hostfile/';

const FETCH_TIMEOUT_MS = 60_000;

@Injectable()
export class BlocklistService implements OnModuleInit {
  private readonly logger = new Logger(BlocklistService.name);
  private readonly sources = new Map<string, SourceData>();

  private combinedUrls = new Set<string>();
  private combinedDomains = new Set<string>();
  lastRefreshAt: Date | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Apagable para tests (evita red y handles abiertos en jest).
    if (process.env.BLOCKLIST_DISABLE_REFRESH === '1') return;
    // No bloquear el arranque: el endpoint responde con las capas que tenga.
    void this.refresh();
  }

  @Cron(CronExpression.EVERY_2_HOURS)
  async refresh(): Promise<void> {
    const jobs: Array<Promise<void>> = [
      this.loadSource('phishtank', () => this.loadPhishTank()),
      this.loadSource('hagezi-tif', () => this.loadHageziTif()),
    ];
    if (this.config.get<string>('URLHAUS_AUTH_KEY')) {
      jobs.push(this.loadSource('urlhaus', () => this.loadUrlhaus()));
    }
    await Promise.allSettled(jobs);
    this.rebuildCombined();
    this.lastRefreshAt = new Date();
    this.logger.log(
      `Listas cargadas: ${this.combinedUrls.size} URLs, ${this.combinedDomains.size} dominios`,
    );
  }

  /** Devuelve el primer match contra las listas, o null si está limpio. */
  lookup(url: URL): BlocklistHit | null {
    const { full, withoutQuery, host } = normalizeForLookup(url);

    if (this.combinedUrls.has(full) || this.combinedUrls.has(withoutQuery)) {
      return { source: this.sourceOfUrl(full, withoutQuery), kind: 'url' };
    }
    for (const domain of domainLookupKeys(host)) {
      if (this.combinedDomains.has(domain)) {
        return { source: this.sourceOfDomain(domain), kind: 'domain' };
      }
    }
    return null;
  }

  /**
   * Dominios bloqueados, para que el Escudo DNS los distribuya al dispositivo.
   * Solo fuentes basadas en dominio: las URLs exactas de PhishTank incluyen
   * sitios legítimos comprometidos o con open-redirects, y bloquear ese
   * dominio entero por DNS rompería el sitio real.
   */
  get blockedDomains(): ReadonlySet<string> {
    return this.combinedDomains;
  }

  get stats() {
    return {
      exactUrls: this.combinedUrls.size,
      domains: this.combinedDomains.size,
      lastRefreshAt: this.lastRefreshAt?.toISOString() ?? null,
      sources: [...this.sources.keys()],
    };
  }

  /** Hay datos suficientes para que "sin señales" signifique algo. */
  get isReady(): boolean {
    return this.combinedUrls.size > 0 || this.combinedDomains.size > 0;
  }

  private async loadSource(
    name: string,
    loader: () => Promise<Pick<SourceData, 'urls' | 'domains'>>,
  ): Promise<void> {
    try {
      const data = await loader();
      this.sources.set(name, { ...data, loadedAt: new Date() });
      this.logger.log(
        `${name}: ${data.urls.size} URLs, ${data.domains.size} dominios`,
      );
    } catch (err) {
      // Se conserva el último dato bueno de esta fuente.
      this.logger.warn(`No se pudo refrescar ${name}: ${err}`);
    }
  }

  private rebuildCombined() {
    const urls = new Set<string>();
    const domains = new Set<string>();
    for (const data of this.sources.values()) {
      for (const u of data.urls) urls.add(u);
      for (const d of data.domains) domains.add(d);
    }
    this.combinedUrls = urls;
    this.combinedDomains = domains;
  }

  private sourceOfUrl(...keys: string[]): string {
    for (const [name, data] of this.sources) {
      if (keys.some((k) => data.urls.has(k))) return name;
    }
    return 'blocklist';
  }

  private sourceOfDomain(domain: string): string {
    for (const [name, data] of this.sources) {
      if (data.domains.has(domain)) return name;
    }
    return 'blocklist';
  }

  private async fetchText(url: string, headers?: Record<string, string>) {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} de ${url}`);
    return res.text();
  }

  private async loadPhishTank() {
    const csv = await this.fetchText(PHISHTANK_URL);
    const urls = new Set<string>();
    const lines = csv.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      const raw = fields[1];
      if (!raw) continue;
      for (const key of phishTankKeys(raw)) urls.add(key);
    }
    return { urls, domains: new Set<string>() };
  }

  private async loadHageziTif() {
    const text = await this.fetchText(HAGEZI_TIF_MINI_URL);
    const domains = new Set<string>();
    for (const line of text.split('\n')) {
      const trimmed = line.trim().toLowerCase();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Sintaxis wildcard: "*.dominio.tld" cubre el dominio y sus subdominios;
      // el lookup ya recorre los padres, así que basta guardar el dominio pelado.
      const domain = trimmed.startsWith('*.') ? trimmed.slice(2) : trimmed;
      domains.add(domain);
    }
    return { urls: new Set<string>(), domains };
  }

  private async loadUrlhaus() {
    const key = this.config.get<string>('URLHAUS_AUTH_KEY')!;
    const text = await this.fetchText(URLHAUS_HOSTFILE_URL, {
      'Auth-Key': key,
    });
    const domains = new Set<string>();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Formato hostfile: "127.0.0.1<tab>dominio"
      const domain = trimmed.split(/\s+/)[1]?.toLowerCase();
      if (domain) domains.add(domain);
    }
    return { urls: new Set<string>(), domains };
  }
}

/**
 * Clave de lookup para una entrada de PhishTank: solo la forma completa
 * (host + path + query). Indexar también la forma sin query sería fatal:
 * PhishTank incluye open-redirects sobre dominios legítimos (p. ej.
 * google.com/?...&url=evil) donde el payload vive en la query — recortarla
 * marcaría como malicioso a todo google.com. La variación de parámetros de
 * tracking la absorbe el lookup, que prueba la URL entrante con y sin query.
 */
export function phishTankKeys(rawUrl: string): string[] {
  try {
    return [normalizeForLookup(new URL(rawUrl)).full];
  } catch {
    return [];
  }
}

/** Parser mínimo de una línea CSV que respeta campos entre comillas. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
