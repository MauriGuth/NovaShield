/**
 * La sincronización de la lista del escudo (código de la APP, no del backend).
 *
 * En el primer Android real el escudo no se podía prender: `loadBlocklist` se
 * rechazaba aunque la descarga saliera bien. `File.move` de expo-file-system
 * devuelve una promesa y se llamaba sin await: el nativo buscaba la lista
 * antes de que el archivo llegara a su lugar. Además la sincronización la
 * disparan el arranque, cada vuelta al frente (volver del diálogo de permiso
 * cuenta), la pantalla Protección y el switch, y en paralelo compartían
 * `blocklist.bin` y su temporal.
 *
 * Este test corre `blocklist-sync.ts` tal cual, con el sistema de archivos y
 * el módulo nativo simulados en memoria con la misma asincronía que Expo.
 */

const HASH_BYTES = 8;
const LIST_SIZE = 64 * HASH_BYTES;
const DIR = '/data/user/0/ar.com.novasolutions.novashield/files';

/** "Disco": uri → cantidad de bytes. */
const disk = new Map<string, number>();
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

const toUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

class MemDirectory {
  constructor(readonly uri: string) {}
  get exists() {
    return true;
  }
  create() {}
}

class MemFile {
  uri: string;
  constructor(...parts: (string | MemFile | MemDirectory)[]) {
    const [first, ...rest] = parts.map((p) => (typeof p === 'string' ? p : p.uri));
    // Igual que Android: una ruta plana revienta (ver toFileUri).
    if (!first.startsWith('file://')) throw new Error('URI is not absolute');
    this.uri = [first.replace(/\/+$/, ''), ...rest].join('/');
  }
  get exists() {
    return disk.has(this.uri);
  }
  get size() {
    return disk.get(this.uri) ?? 0;
  }
  get parentDirectory() {
    return new MemDirectory(this.uri.slice(0, this.uri.lastIndexOf('/')));
  }
  delete() {
    if (!disk.delete(this.uri)) throw new Error(`delete: no existe ${this.uri}`);
  }
  /**
   * Como expo-file-system 57: `move` es asíncrono (la instantánea es
   * `moveSync`). En Android corre en el dispatcher de E/S y en el teléfono
   * terminó DESPUÉS de que el nativo buscara la lista: se simula más lento que
   * `loadBlocklist` para reproducir ese orden, que es el que se vio.
   */
  async move(dest: MemFile) {
    await tick();
    await tick();
    const size = disk.get(this.uri);
    if (size === undefined) throw new Error(`move: no existe ${this.uri}`);
    disk.delete(this.uri);
    disk.set(dest.uri, size);
    this.uri = dest.uri;
  }
  static async downloadFileAsync(_url: string, dest: MemFile) {
    // La descarga tarda: es la ventana en la que otra sincronización se cruza.
    await tick();
    disk.set(dest.uri, 0);
    await tick();
    disk.set(dest.uri, LIST_SIZE);
    return dest;
  }
}

let loadedCount = 0;
const loadRejections: string[] = [];

jest.mock(
  'expo-file-system',
  () => ({ File: MemFile, Paths: { document: new MemDirectory('file:///docs') } }),
  { virtual: true },
);
jest.mock('../../../mobile/src/lib/api', () => ({ API_URL: 'https://api.test' }));
jest.mock('../../../mobile/src/lib/native-shield', () => ({
  NovaShield: {
    getBlocklistDirectory: () => DIR,
    getLoadedDomainCount: () => loadedCount,
    // Como Blocklist.load en Kotlin: lee el archivo del disco un rato después.
    loadBlocklist: async (uri: string) => {
      await tick();
      const size = disk.get(uri);
      if (size === undefined) {
        loadRejections.push(uri);
        throw new Error(
          "Call to function 'NovaShield.loadBlocklist' has been rejected.\n→ Caused by: No existe la lista",
        );
      }
      loadedCount = size / HASH_BYTES;
      return loadedCount;
    },
  },
}));

const store = {
  blocklistVersion: null as string | null,
  blocklistCheckedAt: null as number | null,
  blocklistDomainCount: 0,
  recordBlocklistSync({ version, domainCount }: { version: string; domainCount: number }) {
    store.blocklistVersion = version;
    store.blocklistCheckedAt = Date.now();
    store.blocklistDomainCount = domainCount;
  },
};
jest.mock('../../../mobile/src/lib/store', () => ({
  useShield: { getState: () => store },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sync = require('../../../mobile/src/lib/blocklist-sync') as typeof import('../../../mobile/src/lib/blocklist-sync');

beforeEach(() => {
  disk.clear();
  loadedCount = 0;
  loadRejections.length = 0;
  store.blocklistVersion = null;
  store.blocklistCheckedAt = null;
  store.blocklistDomainCount = 0;
  global.fetch = jest.fn(async () => {
    await tick();
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        version: 'v1',
        domainCount: LIST_SIZE / HASH_BYTES,
        sizeBytes: LIST_SIZE,
        hashBytes: HASH_BYTES,
      }),
    };
  }) as unknown as typeof fetch;
});

describe('blocklist-sync · sincronizaciones que se cruzan', () => {
  it('una sincronización sola deja la lista cargada (move asíncrono, como en Android)', async () => {
    const result = await sync.runBlocklistSync();
    expect(result.status).toBe('updated');
    expect(loadRejections).toEqual([]);
    expect(loadedCount).toBe(LIST_SIZE / HASH_BYTES);
  });

  it('con la cola, arranque + Protección + switch terminan con la lista cargada', async () => {
    const results = await Promise.all([
      sync.runBlocklistSync(),
      sync.runBlocklistSync(),
      sync.runBlocklistSync({ force: true }),
      sync.runBlocklistSync(),
    ]);
    expect(results.map((r) => r.status)).not.toContain('failed');
    expect(loadRejections).toEqual([]);
    expect(loadedCount).toBe(LIST_SIZE / HASH_BYTES);
    expect(disk.get(`file://${DIR}/blocklist.bin`)).toBe(LIST_SIZE);
    expect(disk.has(`file://${DIR}/blocklist.bin.download`)).toBe(false);
  });

  it('una falla no traba la cola: la siguiente sincronización corre igual', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('sin red');
    });
    const first = await sync.runBlocklistSync({ force: true });
    const second = await sync.runBlocklistSync({ force: true });
    expect(first.status).toBe('failed');
    expect(second.status).toBe('updated');
  });

  it('el error que se muestra conserva la causa nativa, no la primera línea', () => {
    const err = new Error(
      "Call to function 'NovaShield.loadBlocklist' has been rejected.\n→ Caused by: No existe la lista en /data/x\n  at java.io.File.<init>(File.java:424)",
    );
    expect(sync.describeError(err)).toBe('No existe la lista en /data/x');
    expect(sync.describeError(new Error('sin red'))).toBe('sin red');
  });

  it('ninguna operación asíncrona de archivos de la app queda sin await', () => {
    // `move` y `copy` de expo-file-system devuelven promesas (las instantáneas
    // son `moveSync`/`copySync`). TypeScript no avisa si se llaman sin await,
    // y así se rompió el escudo en Android.
    const { readdirSync, readFileSync, statSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    const { join } = jest.requireActual<typeof import('node:path')>('node:path');
    const root = join(__dirname, '..', '..', '..', 'mobile', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(root);
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), at: `${file}:${i + 1}` }))
        .filter(({ line }) => /\.(move|copy)\(/.test(line))
        .filter(({ line }) => !/^(await|return)\b/.test(line) && !line.startsWith('//') && !line.startsWith('*'))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });

  it('la carpeta del nativo se pasa como URI file://', () => {
    expect(sync.toFileUri(DIR)).toBe(toUri(DIR));
    expect(sync.toFileUri(`file://${DIR}`)).toBe(`file://${DIR}`);
  });
});
