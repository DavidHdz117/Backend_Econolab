import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import type { ColumnOptions } from 'typeorm';
import {
  getDatabaseRuntimeConfig,
  type SupportedDatabaseType,
} from '../config/database.config';

let resolvedDatabaseType: SupportedDatabaseType | null = null;

function ensureDatabaseEnvLoaded() {
  if (resolvedDatabaseType) {
    return;
  }

  const candidates = [
    resolve(__dirname, '..', '..', '.env'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'backend', '.env'),
  ];

  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) {
      continue;
    }

    loadDotEnv({ path: candidate, override: false });
    break;
  }
}

function getResolvedDatabaseType() {
  if (!resolvedDatabaseType) {
    ensureDatabaseEnvLoaded();
    resolvedDatabaseType = getDatabaseRuntimeConfig().type;
  }

  return resolvedDatabaseType;
}

function isSqliteRuntime() {
  return getResolvedDatabaseType() === 'sqlite';
}

type PortableTimestampMode = 'timestamp' | 'timestamptz';

function getPortableTimestampType(mode: PortableTimestampMode) {
  if (isSqliteRuntime()) {
    return 'datetime' as const;
  }

  return mode;
}

export function getPortableTimestampColumnOptions(
  options: Omit<ColumnOptions, 'type'> = {},
  mode: PortableTimestampMode = 'timestamptz',
): ColumnOptions {
  return {
    ...options,
    type: getPortableTimestampType(mode),
  };
}

export function getPortableCreateDateColumnOptions(
  options: Omit<ColumnOptions, 'type'> = {},
  mode: PortableTimestampMode = 'timestamptz',
): ColumnOptions {
  return {
    ...options,
    type: getPortableTimestampType(mode),
  };
}

export function getPortableUpdateDateColumnOptions(
  options: Omit<ColumnOptions, 'type'> = {},
  mode: PortableTimestampMode = 'timestamptz',
): ColumnOptions {
  return {
    ...options,
    type: getPortableTimestampType(mode),
  };
}

export function getPortableEnumColumnOptions<T extends Record<string, string>>(
  enumValues: T,
  defaultValue?: T[keyof T],
  options: Omit<ColumnOptions, 'type' | 'enum' | 'default'> = {},
): ColumnOptions {
  return {
    ...options,
    type: isSqliteRuntime() ? 'simple-enum' : 'enum',
    enum: enumValues,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  };
}

export function getPortableJsonColumnOptions(
  defaultValue = '[]',
  options: Omit<ColumnOptions, 'type' | 'default'> = {},
): ColumnOptions {
  if (isSqliteRuntime()) {
    return {
      ...options,
      type: 'simple-json',
      default: defaultValue,
    };
  }

  const escapedDefault = defaultValue.replace(/'/g, "''");

  return {
    ...options,
    type: 'jsonb',
    default: () => `'${escapedDefault}'`,
  };
}

export function getPortableIntegerArrayColumnOptions(
  options: Omit<ColumnOptions, 'type' | 'array' | 'default'> = {},
): ColumnOptions {
  if (isSqliteRuntime()) {
    return {
      ...options,
      type: 'simple-json',
      default: '[]',
    };
  }

  return {
    ...options,
    type: 'int',
    array: true,
    default: () => 'ARRAY[]::INTEGER[]',
  };
}

export function getPortableGeneratedPrimaryColumnOptions(
  preferBigInt = false,
) {
  if (isSqliteRuntime()) {
    return { type: 'integer' as const };
  }

  if (preferBigInt) {
    return { type: 'bigint' as const };
  }

  return { type: 'int' as const };
}
