import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * Persistencia del backend (hoy: solo Modo Familia).
 *
 * - Producción (Railway): `DATABASE_URL` → PostgreSQL.
 * - Desarrollo y tests: better-sqlite3 en un archivo local (o ':memory:' vía
 *   `FAMILY_DB_PATH`, que usan los e2e). Sin servicios que levantar.
 *
 * Las entidades usan solo tipos portables entre ambos motores (ver
 * family.entities.ts).
 *
 * `synchronize` queda APAGADO en PostgreSQL: la propia documentación de NestJS
 * advierte que "shouldn't be used in production - otherwise you can lose
 * production data". En producción el esquema se crea con migraciones; para
 * arrancar el primer deploy alcanza con `FAMILY_DB_SYNC=1` una vez, a
 * conciencia. En sqlite (dev/tests, base descartable) sincroniza siempre.
 */
export function buildDatabaseOptions(): TypeOrmModuleOptions {
  const url = process.env.DATABASE_URL;
  if (url) {
    // eslint-disable-next-line no-console
    console.log('Base de datos: PostgreSQL (DATABASE_URL)');
    return {
      type: 'postgres',
      url,
      autoLoadEntities: true,
      synchronize: process.env.FAMILY_DB_SYNC === '1',
    };
  }

  // En producción, caer a sqlite sería silencioso y peligroso: el archivo vive
  // en el contenedor, así que cada deploy borraría las familias, y encima el
  // proceso corre sin permiso de escritura. Antes de eso, error claro.
  //
  // Ojo con Railway: agregar un PostgreSQL al proyecto NO inyecta DATABASE_URL
  // en los demás servicios. Hay que declararla a mano en el servicio del
  // backend como referencia: DATABASE_URL=${{Postgres.DATABASE_URL}}
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Falta DATABASE_URL. En producción el Modo Familia necesita PostgreSQL; ' +
        'en Railway declarala en el servicio del backend como ${{Postgres.DATABASE_URL}}.',
    );
  }

  const database = process.env.FAMILY_DB_PATH ?? join(process.cwd(), 'data', 'novashield.sqlite');
  if (database !== ':memory:') {
    mkdirSync(dirname(database), { recursive: true });
  }
  // eslint-disable-next-line no-console
  console.log(`Base de datos: sqlite (${database})`);

  return {
    type: 'better-sqlite3',
    database,
    autoLoadEntities: true,
    synchronize: true,
  };
}
