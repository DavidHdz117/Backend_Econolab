import { ConfigService } from '@nestjs/config';
import { Pool, type PoolConfig } from 'pg';
import { DB_ADMIN_POOL, DB_RECEPCIONISTA_POOL } from './database.constants';

const toNumber = (
  value: string | number | undefined,
  fallback: number,
): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const resolveSsl = (value: string | undefined): PoolConfig['ssl'] => {
  if (!value) return { rejectUnauthorized: false };

  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off')
    return false;
  return { rejectUnauthorized: false };
};

const buildBaseConfig = (config: ConfigService): PoolConfig => ({
  host: config.get<string>('DATABASE_HOST'),
  port: toNumber(config.get<string>('DATABASE_PORT'), 5432),
  database: config.get<string>('DATABASE_NAME'),
  ssl: resolveSsl(config.get<string>('DATABASE_SSL')),
});

export const databaseProviders = [
  {
    provide: DB_ADMIN_POOL,
    inject: [ConfigService],
    useFactory: (config: ConfigService) =>
      new Pool({
        ...buildBaseConfig(config),
        user: config.get<string>('DATABASE_ADMIN_USER') ?? 'db_admin',
        password: config.get<string>('DATABASE_ADMIN_PASS') ?? 'admin_password',
      }),
  },
  {
    provide: DB_RECEPCIONISTA_POOL,
    inject: [ConfigService],
    useFactory: (config: ConfigService) =>
      new Pool({
        ...buildBaseConfig(config),
        user:
          config.get<string>('DATABASE_RECEPCIONISTA_USER') ??
          'db_recepcionista',
        password:
          config.get<string>('DATABASE_RECEPCIONISTA_PASS') ?? 'recep_password',
      }),
  },
];
