import { registerAs } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import {
  parseBooleanEnv,
  parseNumberEnv,
  parseOptionalStringEnv,
} from './env.utils';

export type SupportedDatabaseType = 'postgres' | 'sqlite';
const runtimeRequire = createRequire(__filename);

function normalizeDatabaseType(value?: string): SupportedDatabaseType {
  return value?.trim().toLowerCase() === 'sqlite' ? 'sqlite' : 'postgres';
}

function resolveSQLitePath(value?: string) {
  return resolve(process.cwd(), value?.trim() || 'data/econolab.sqlite');
}

function ensureSqliteDriverInstalled() {
  try {
    runtimeRequire.resolve('sqlite3');
  } catch {
    throw new Error(
      'DATABASE_TYPE=sqlite requiere el paquete "sqlite3". Instalala antes de activar el modo local.',
    );
  }
}

export function getDatabaseRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
) {
  const type = normalizeDatabaseType(env.DATABASE_TYPE);

  return {
    type,
    host: parseOptionalStringEnv(env.DATABASE_HOST),
    port: parseNumberEnv(env.DATABASE_PORT, 5432),
    username: parseOptionalStringEnv(env.DATABASE_USER),
    password: parseOptionalStringEnv(env.DATABASE_PASS),
    name: parseOptionalStringEnv(env.DATABASE_NAME),
    ssl: parseBooleanEnv(env.DATABASE_SSL, type === 'postgres'),
    logging: parseBooleanEnv(env.DATABASE_LOGGING, true),
    synchronize: parseBooleanEnv(env.DATABASE_SYNCHRONIZE, true),
    sqlitePath: resolveSQLitePath(env.DATABASE_SQLITE_PATH),
  };
}

export type DatabaseRuntimeConfig = ReturnType<typeof getDatabaseRuntimeConfig>;

export const databaseConfig = registerAs('database', () =>
  getDatabaseRuntimeConfig(),
);

function buildBaseDatabaseOptions(database: DatabaseRuntimeConfig) {
  if (database.type === 'sqlite') {
    ensureSqliteDriverInstalled();
    mkdirSync(dirname(database.sqlitePath), { recursive: true });

    return {
      type: 'sqlite' as const,
      database: database.sqlitePath,
      logging: database.logging,
    };
  }

  return {
    type: 'postgres' as const,
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.name,
    ssl: database.ssl,
    logging: database.logging,
  };
}

export function buildTypeOrmModuleOptions(
  database: DatabaseRuntimeConfig,
): TypeOrmModuleOptions {
  return {
    ...buildBaseDatabaseOptions(database),
    autoLoadEntities: true,
    synchronize: database.synchronize,
  } as TypeOrmModuleOptions;
}

export function buildTypeOrmDataSourceOptions(
  database: DatabaseRuntimeConfig,
  entities: string[],
  migrations: string[],
): DataSourceOptions {
  return {
    ...buildBaseDatabaseOptions(database),
    synchronize: false,
    entities,
    migrations,
  } as DataSourceOptions;
}
