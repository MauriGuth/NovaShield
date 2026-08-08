import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  BlocklistMetadata,
  HASH_BYTES,
  canonicalDomain,
} from '@novashield/shared';
import { BlocklistService } from '../analysis/layers/blocklist.service';

/**
 * Distribución de la lista de bloqueo al Escudo DNS de cada dispositivo.
 *
 * Sirve un único Buffer con los SHA-256 truncados a HASH_BYTES de todos los
 * dominios bloqueados, ordenado ascendentemente: el dispositivo lo guarda tal
 * cual y resuelve cada consulta DNS con una búsqueda binaria local, sin
 * contactar al servidor ni una sola vez.
 */

@Injectable()
export class ShieldService {
  private readonly logger = new Logger(ShieldService.name);

  /** Hashes truncados, ordenados. Es exactamente lo que baja el dispositivo. */
  private hashes: Buffer = Buffer.alloc(0);
  private version = 'empty';
  private builtFrom: string | null = null;
  private builtAt: Date | null = null;

  constructor(private readonly blocklists: BlocklistService) {}

  /** ¿Hay un índice servible? Falso mientras las fuentes no cargaron. */
  get isReady(): boolean {
    this.ensureIndex();
    return this.hashes.length > 0;
  }

  /** Rehace el índice si la lista de amenazas se refrescó desde la última vez. */
  private ensureIndex(): void {
    const refreshedAt = this.blocklists.lastRefreshAt?.toISOString() ?? null;
    if (refreshedAt === this.builtFrom && this.builtAt !== null) return;

    const domains = this.blocklists.blockedDomains;

    // Sin dominios NO se publica nada, y `builtFrom` queda intacto para
    // reintentar en la próxima consulta. Publicar una lista vacía es peor que
    // no publicar: el dispositivo la instalaría, la daría por buena y se
    // quedaría hasta siete días con el escudo diciendo "activo" sin bloquear un
    // solo dominio. Ojo: `blocklists.isReady` no sirve como guarda acá, porque
    // es true si cargó CUALQUIER fuente — con PhishTank (URLs) arriba y HaGeZi
    // (dominios) caído, el escudo se quedaría igual sin nada que bloquear.
    if (domains.size === 0) {
      this.logger.warn(
        'Sin dominios en la capa 1: no se publica índice del escudo (se reintenta en la próxima consulta).',
      );
      return;
    }
    const records: Buffer[] = [];
    for (const domain of domains) {
      const canonical = canonicalDomain(domain);
      if (!canonical) continue;
      records.push(hashDomain(canonical));
    }
    records.sort(Buffer.compare);

    // Dedupe: dos dominios distintos casi nunca colisionan, pero la lista
    // puede traer el mismo dominio desde dos fuentes.
    const deduped: Buffer[] = [];
    let previous: Buffer | null = null;
    for (const record of records) {
      if (previous && previous.equals(record)) continue;
      deduped.push(record);
      previous = record;
    }

    this.hashes = Buffer.concat(deduped);
    this.version = createHash('sha256')
      .update(this.hashes)
      .digest('hex')
      .slice(0, 16);
    this.builtFrom = refreshedAt;
    this.builtAt = new Date();

    this.logger.log(
      `Índice del escudo: ${deduped.length} dominios (${(this.hashes.length / 1024 / 1024).toFixed(2)} MB, v${this.version})`,
    );
  }

  getMetadata(): BlocklistMetadata {
    this.ensureIndex();
    return {
      version: this.version,
      domainCount: this.hashes.length / HASH_BYTES,
      hashBytes: HASH_BYTES,
      sizeBytes: this.hashes.length,
      updatedAt: (this.builtAt ?? new Date()).toISOString(),
      sources: this.blocklists.stats.sources,
    };
  }

  /** Buffer binario ordenado (el dispositivo hace búsqueda binaria sobre él). */
  getHashes(): { buffer: Buffer; version: string } {
    this.ensureIndex();
    return { buffer: this.hashes, version: this.version };
  }

  /**
   * Mismo matching que hace el dispositivo. Existe para poder testear que
   * cliente y servidor coinciden, y para diagnóstico.
   */
  isBlocked(domain: string): boolean {
    this.ensureIndex();
    const target = hashDomain(canonicalDomain(domain));
    let lo = 0;
    let hi = this.hashes.length / HASH_BYTES - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const record = this.hashes.subarray(mid * HASH_BYTES, (mid + 1) * HASH_BYTES);
      const cmp = Buffer.compare(record, target);
      if (cmp === 0) return true;
      if (cmp < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }
}

/** SHA-256 del dominio canónico, truncado. Debe coincidir bit a bit con el cliente. */
export function hashDomain(canonicalDomainName: string): Buffer {
  return createHash('sha256')
    .update(canonicalDomainName, 'utf8')
    .digest()
    .subarray(0, HASH_BYTES);
}
