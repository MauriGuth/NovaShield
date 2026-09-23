import { HASH_BYTES, type BlocklistMetadata } from '@novashield/shared';
import { File, Paths } from 'expo-file-system';
import { API_URL } from './api';
import { NovaShield } from './native-shield';
import { useShield as useShieldStore } from './store';

/**
 * Sincronización de la lista de bloqueo del Escudo DNS.
 *
 * La lista se descarga entera (~1,3 MB) y se guarda en el dispositivo; el
 * matching de cada consulta DNS lo hace el módulo nativo contra ese archivo,
 * sin red.
 *
 * El chequeo es diario y corre al arrancar la app y al volver al frente
 * (`runBlocklistSync` desde _layout.tsx). Era semanal y solo se disparaba al
 * abrir la pestaña Protección: un dominio que HaGeZi sumaba el martes no le
 * llegaba nunca a quien no volvía a esa pestaña, con el escudo diciendo
 * "activo · 170.000 dominios". El chequeo diario cuesta ~200 bytes cuando la
 * lista no cambió (ETag + 304); la descarga completa solo ocurre si cambió.
 *
 * TODO (Fase 2.1): descarga incremental. El servidor ya versiona la lista;
 * falta servir el diff contra una versión previa para bajar unos KB en vez de
 * la lista entera cuando cambia.
 */

const FILE_NAME = 'blocklist.bin';
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Tras una falla no se reintenta en cada vuelta al frente: eso es martillar al backend. */
const RETRY_BACKOFF_MS = 15 * 60 * 1000;
let retryNotBefore = 0;

export interface SyncResult {
  /**
   * `updated` y `up-to-date` implican que se habló con el servidor (y se
   * registran como chequeo real); `skipped` significa que ni lo intentamos
   * (intervalo no vencido, o build sin módulo nativo) y NO debe registrarse
   * como chequeo, o el refresco semanal no se dispararía nunca.
   */
  status: 'updated' | 'up-to-date' | 'skipped' | 'failed';
  version?: string;
  domainCount?: number;
  sizeBytes?: number;
  error?: string;
}

export interface SyncState {
  version: string | null;
  lastCheckedAt: number | null;
}

/**
 * La API de archivos de Expo quiere URIs (`file:///…`), y el nativo devuelve
 * rutas planas (`/data/user/0/…/files`). iOS acepta la ruta plana; Android
 * revienta con "URI is not absolute" y la lista no se descarga NUNCA, así que
 * el escudo no se puede prender. Las rutas las arma el sistema (paquete y App
 * Group, solo ASCII sin espacios): no hace falta codificarlas, y el nativo le
 * saca el `file://` al recibirlas en `loadBlocklist`.
 */
export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/** Directorio donde vive la lista: el nativo manda, porque en iOS debe ser el App Group. */
function blocklistFile(): File {
  const dir = NovaShield?.getBlocklistDirectory();
  if (dir) return new File(toFileUri(dir), FILE_NAME);
  return new File(Paths.document, FILE_NAME);
}

/**
 * Primera línea del error, sin la traza nativa: la pantalla la muestra tal
 * cual, y veinte líneas de Java no le dicen nada a nadie.
 */
function firstLine(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split('\n')[0].trim();
}

export function isSyncDue(state: SyncState, now = Date.now()): boolean {
  if (state.version === null) return true;
  if (state.lastCheckedAt === null) return true;
  return now - state.lastCheckedAt >= SYNC_INTERVAL_MS;
}

/**
 * Descarga la lista si cambió y se la entrega al módulo nativo.
 * `force` ignora el intervalo (botón "Actualizar ahora" de la UI).
 */
export async function syncBlocklist(
  state: SyncState,
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  if (!NovaShield) {
    return { status: 'skipped', error: 'El escudo no está disponible en este build.' };
  }
  // El proceso pudo haberse reiniciado con la lista en disco y el nativo sin
  // nada en memoria. Se recarga localmente (sin red) ANTES de mirar intervalos
  // y esperas: si no, tras una falla de red el escudo no se podía prender
  // durante el backoff aunque la lista buena estuviera ahí.
  if (state.version && NovaShield.getLoadedDomainCount() === 0) {
    const onDisk = blocklistFile();
    if (onDisk.exists) {
      try {
        await NovaShield.loadBlocklist(onDisk.uri, state.version);
      } catch {
        // Archivo ilegible: que la próxima sincronización lo re-descargue.
      }
    }
  }

  if (!options.force && Date.now() < retryNotBefore) {
    return { status: 'skipped', version: state.version ?? undefined };
  }
  if (!options.force && !isSyncDue(state)) {
    return { status: 'skipped', version: state.version ?? undefined };
  }

  let metadata: BlocklistMetadata;
  try {
    const res = await fetch(`${API_URL}/v1/shield/metadata`);
    if (res.status === 429 || res.status === 503) {
      // 429: demasiadas consultas desde esta IP (compartida con miles de
      // personas detrás del CGNAT de la operadora). 503: el servidor todavía
      // está cargando las fuentes. En los dos casos hay que esperar, y el
      // servidor dice cuánto.
      const wait = Number(res.headers.get('Retry-After'));
      retryNotBefore =
        Date.now() +
        (Number.isFinite(wait) && wait > 0 ? wait * 1000 : RETRY_BACKOFF_MS);
      return {
        status: 'failed',
        error:
          res.status === 429
            ? 'Demasiadas consultas seguidas al servidor. Lo reintentamos solos en unos minutos; la lista actual sigue activa.'
            : 'El servidor todavía está preparando la lista. Lo reintentamos solos en unos minutos; la lista actual sigue activa.',
      };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    metadata = (await res.json()) as BlocklistMetadata;
  } catch (err) {
    retryNotBefore = Date.now() + RETRY_BACKOFF_MS;
    return { status: 'failed', error: `No pudimos consultar la lista: ${err}` };
  }

  // Un servidor que anuncia una lista vacía está roto o arrancando: instalar
  // "nada" encima de una lista buena dejaría el escudo sin bloquear.
  if (metadata.domainCount <= 0 || metadata.sizeBytes <= 0) {
    return {
      status: 'failed',
      error: 'El servidor devolvió una lista vacía; conservamos la actual.',
    };
  }

  const target = blocklistFile();

  try {
    // Ya tenemos esta versión en disco: solo hay que asegurarse de que el
    // proceso del escudo la tenga cargada (puede haberse reiniciado).
    if (metadata.version === state.version && target.exists) {
      const size = target.size ?? 0;
      if (size === metadata.sizeBytes && size % HASH_BYTES === 0) {
        await NovaShield.loadBlocklist(target.uri, metadata.version);
        return {
          status: 'up-to-date',
          version: metadata.version,
          domainCount: metadata.domainCount,
          sizeBytes: metadata.sizeBytes,
        };
      }
      // Archivo corrupto o truncado (descarga anterior interrumpida): se
      // descarta y se cae a la descarga completa de acá abajo.
      target.delete();
    }

    const parent = target.parentDirectory;
    if (!parent.exists) parent.create({ intermediates: true });

    // Descarga a un archivo temporal + validación + promoción. Nunca se pisa
    // `blocklist.bin` in place: si la descarga se corta a la mitad, el escudo
    // seguiría leyendo el archivo bueno anterior, no uno truncado.
    const temp = new File(parent, `${FILE_NAME}.download`);
    if (temp.exists) temp.delete();
    await File.downloadFileAsync(`${API_URL}/v1/shield/blocklist`, temp, {
      idempotent: true,
    });

    const size = temp.size ?? 0;
    if (size !== metadata.sizeBytes || size % HASH_BYTES !== 0) {
      temp.delete();
      return {
        status: 'failed',
        error: `Descarga incompleta (${size} de ${metadata.sizeBytes} bytes); conservamos la lista actual.`,
      };
    }

    if (target.exists) target.delete();
    temp.move(target);

    const domainCount = await NovaShield.loadBlocklist(
      target.uri,
      metadata.version,
    );
    return {
      status: 'updated',
      version: metadata.version,
      domainCount,
      sizeBytes: metadata.sizeBytes,
    };
  } catch (err) {
    return {
      status: 'failed',
      error: `No pudimos guardar la lista en el teléfono. Detalle: ${firstLine(err)}`,
    };
  }
}

/**
 * Sincroniza leyendo y actualizando el store. Es el único punto que registra
 * el chequeo: lo usan la pantalla Protección (botón "Actualizar ahora"), el
 * hook del escudo y el arranque de la app.
 *
 * Solo `updated`/`up-to-date` son chequeos reales contra el servidor.
 * Registrar un `skipped` como chequeo movería la fecha sin haber consultado
 * nada y el refresco diario no se dispararía nunca.
 */
export async function runBlocklistSync(
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  const snapshot = useShieldStore.getState();
  const result = await syncBlocklist(
    {
      version: snapshot.blocklistVersion,
      lastCheckedAt: snapshot.blocklistCheckedAt,
    },
    options,
  );
  if (
    (result.status === 'updated' || result.status === 'up-to-date') &&
    result.version
  ) {
    snapshot.recordBlocklistSync({
      version: result.version,
      domainCount: result.domainCount ?? snapshot.blocklistDomainCount ?? 0,
    });
  }
  return result;
}
