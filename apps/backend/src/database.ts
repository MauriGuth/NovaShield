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
    return {
      type: 'postgres',
      url,
      autoLoadEntities: true,
      synchronize: process.env.FAMILY_DB_SYNC === '1',
    };
  }

  const database = process.env.FAMILY_DB_PATH ?? join(process.cwd(), 'data', 'novashield.sqlite');
  if (database !== ':memory:') {
    mkdirSync(dirname(database), { recursive: true });
  }

  return {
    type: 'better-sqlite3',
    database,
    autoLoadEntities: true,
    synchronize: true,
  };
}
