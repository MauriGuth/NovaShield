import { HASH_BYTES, type BlocklistMetadata } from '@novashield/shared';
import { File, Paths } from 'expo-file-system';
import { API_URL } from './api';
import { NovaShield } from './native-shield';

/**
 * Sincronización de la lista de bloqueo del Escudo DNS.
 *
 * La lista se descarga entera (~1,3 MB) y se guarda en el dispositivo; el
 * matching de cada consulta DNS lo hace el módulo nativo contra ese archivo,
 * sin red. Por eso la sincronización es semanal por defecto: bajar 1,3 MB por
 * día sería inaceptable con datos móviles en Argentina.
 *
 * TODO (Fase 2.1): descarga incremental. El servidor ya versiona la lista;
 * falta servir el diff contra una versión previa para bajar unos KB en vez de
 * la lista entera cuando cambia.
 */

const FILE_NAME = 'blocklist.bin';
const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Directorio donde vive la lista: el nativo manda, porque en iOS debe ser el App Group. */
function blocklistFile(): File {
  const dir = NovaShield?.getBlocklistDirectory();
  if (dir) return new File(dir, FILE_NAME);
  return new File(Paths.document, FILE_NAME);
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
  if (!options.force && !isSyncDue(state)) {
    // El intervalo no venció, pero el proceso pudo haberse reiniciado con el
    // store diciendo "sincronizado recién": si el nativo quedó sin lista en
    // memoria y el archivo está en disco, se recarga localmente (sin red).
    if (state.version && NovaShield.getLoadedDomainCount() === 0) {
      const target = blocklistFile();
      if (target.exists) {
        try {
          await NovaShield.loadBlocklist(target.uri, state.version);
        } catch {
          // Archivo ilegible: que la próxima sincronización lo re-descargue.
        }
      }
    }
    return { status: 'skipped', version: state.version ?? undefined };
  }

  let metadata: BlocklistMetadata;
  try {
    const res = await fetch(`${API_URL}/v1/shield/metadata`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    metadata = (await res.json()) as BlocklistMetadata;
  } catch (err) {
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
    return { status: 'failed', error: `No pudimos actualizar la lista: ${err}` };
  }
}
