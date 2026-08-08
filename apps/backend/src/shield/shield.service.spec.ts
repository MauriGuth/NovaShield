import { HASH_BYTES, canonicalDomain, domainLookupKeys } from '@novashield/shared';
import { BlocklistService } from '../analysis/layers/blocklist.service';
import { hashDomain, ShieldService } from './shield.service';

function makeService(domains: string[], refreshedAt = new Date()) {
  const blocklists = {
    blockedDomains: new Set(domains),
    lastRefreshAt: refreshedAt,
    stats: { sources: ['test'] },
  } as unknown as BlocklistService;
  return new ShieldService(blocklists);
}

describe('ShieldService', () => {
  const DOMAINS = [
    'malo.com',
    'phishing-banco.top',
    'login.002307.com',
    'estafa.com.ar',
  ];

  it('publica metadatos consistentes con la lista', () => {
    const meta = makeService(DOMAINS).getMetadata();
    expect(meta.domainCount).toBe(DOMAINS.length);
    expect(meta.hashBytes).toBe(HASH_BYTES);
    expect(meta.sizeBytes).toBe(DOMAINS.length * HASH_BYTES);
    expect(meta.sources).toEqual(['test']);
    expect(meta.version).toHaveLength(16);
  });

  it('sirve los hashes ordenados y sin duplicados', () => {
    const { buffer } = makeService([...DOMAINS, 'malo.com']).getHashes();
    expect(buffer.length).toBe(DOMAINS.length * HASH_BYTES);

    for (let i = HASH_BYTES; i < buffer.length; i += HASH_BYTES) {
      const prev = buffer.subarray(i - HASH_BYTES, i);
      const curr = buffer.subarray(i, i + HASH_BYTES);
      expect(Buffer.compare(prev, curr)).toBeLessThan(0);
    }
  });

  it('el hash de cada dominio bloqueado está en el buffer', () => {
    const { buffer } = makeService(DOMAINS).getHashes();
    for (const domain of DOMAINS) {
      const target = hashDomain(canonicalDomain(domain));
      let found = false;
      for (let i = 0; i < buffer.length; i += HASH_BYTES) {
        if (buffer.subarray(i, i + HASH_BYTES).equals(target)) found = true;
      }
      expect(found).toBe(true);
    }
  });

  describe('isBlocked (mismo matching que hace el dispositivo)', () => {
    const service = makeService(DOMAINS);

    it.each(DOMAINS)('bloquea %s', (domain) => {
      expect(service.isBlocked(domain)).toBe(true);
    });

    it.each(['google.com', 'mercadopago.com.ar', 'nova.com.ar'])(
      'deja pasar %s',
      (domain) => {
        expect(service.isBlocked(domain)).toBe(false);
      },
    );

    it('es insensible a mayúsculas y punto final', () => {
      expect(service.isBlocked('MALO.com.')).toBe(true);
    });

    it('un subdominio se bloquea consultando las claves del dominio padre', () => {
      // El cliente prueba cada clave; el dominio padre está en la lista.
      const keys = domainLookupKeys('login.secure.malo.com');
      expect(keys.some((k) => service.isBlocked(k))).toBe(true);
      // El host completo por sí solo no está: por eso hay que probar los padres.
      expect(service.isBlocked('login.secure.malo.com')).toBe(false);
    });
  });

  it('la versión cambia si cambia la lista y se mantiene si no', () => {
    const at = new Date();
    const v1 = makeService(DOMAINS, at).getMetadata().version;
    const v1bis = makeService(DOMAINS, at).getMetadata().version;
    const v2 = makeService([...DOMAINS, 'otro-malo.com'], at).getMetadata().version;

    expect(v1).toBe(v1bis);
    expect(v2).not.toBe(v1);
  });

  it('el orden de las fuentes no cambia la versión (buffer ordenado)', () => {
    const at = new Date();
    const a = makeService(DOMAINS, at).getMetadata().version;
    const b = makeService([...DOMAINS].reverse(), at).getMetadata().version;
    expect(a).toBe(b);
  });

  it('reconstruye el índice cuando la lista se refresca', () => {
    const blocklists = {
      blockedDomains: new Set(['uno.com']),
      lastRefreshAt: new Date('2026-01-01'),
      stats: { sources: ['test'] },
    } as unknown as BlocklistService;
    const service = new ShieldService(blocklists);
    expect(service.getMetadata().domainCount).toBe(1);
    expect(service.isBlocked('dos.com')).toBe(false);

    const mutable = blocklists as unknown as {
      blockedDomains: Set<string>;
      lastRefreshAt: Date;
    };
    mutable.blockedDomains = new Set(['uno.com', 'dos.com']);
    mutable.lastRefreshAt = new Date('2026-01-02');

    expect(service.getMetadata().domainCount).toBe(2);
    expect(service.isBlocked('dos.com')).toBe(true);
  });

  it('con la fuente vacía NO publica índice: isReady queda en false', () => {
    // Publicar una lista vacía sería fail-open: el dispositivo la instalaría
    // y se quedaría una semana "protegiendo" sin bloquear nada. El controller
    // usa isReady para responder 503 en ese caso.
    const service = makeService([]);
    expect(service.isReady).toBe(false);
    expect(service.isBlocked('cualquiera.com')).toBe(false);
  });

  it('se recupera solo cuando la fuente carga después del arranque en frío', () => {
    const blocklists = {
      blockedDomains: new Set<string>(),
      lastRefreshAt: null as Date | null,
      stats: { sources: ['test'] },
    } as unknown as BlocklistService;
    const service = new ShieldService(blocklists);
    expect(service.isReady).toBe(false);

    const mutable = blocklists as unknown as {
      blockedDomains: Set<string>;
      lastRefreshAt: Date | null;
    };
    mutable.blockedDomains = new Set(['malo.com']);
    mutable.lastRefreshAt = new Date();

    expect(service.isReady).toBe(true);
    expect(service.getMetadata().domainCount).toBe(1);
    expect(service.isBlocked('malo.com')).toBe(true);
  });
});
