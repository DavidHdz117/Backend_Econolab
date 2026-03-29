import { registerAs } from '@nestjs/config';
import type { AppRuntimeMode } from './app.config';
import { getAppRuntimeConfig } from './app.config';
import {
  parseBooleanEnv,
  parseNumberEnv,
  parseOptionalStringEnv,
} from './env.utils';

function getDefaultOriginForRuntime(runtimeMode: AppRuntimeMode) {
  switch (runtimeMode) {
    case 'desktop-online':
      return 'desktop-online';
    case 'desktop-offline':
      return 'desktop-offline';
    case 'web-online':
    default:
      return 'server';
  }
}

function normalizeMachineHeaderName(value?: string) {
  return value?.trim().toLowerCase() || 'x-sync-token';
}

export function getSyncRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const { runtimeMode } = getAppRuntimeConfig(env);
  const machineToken = parseOptionalStringEnv(env.SYNC_MACHINE_TOKEN);

  return {
    outboxEnabled: parseBooleanEnv(
      env.SYNC_OUTBOX_ENABLED,
      runtimeMode !== 'web-online',
    ),
    defaultOrigin:
      parseOptionalStringEnv(env.SYNC_DEFAULT_ORIGIN) ??
      getDefaultOriginForRuntime(runtimeMode),
    outboxBatchSize: parseNumberEnv(env.SYNC_OUTBOX_BATCH_SIZE, 100),
    retryDelaySeconds: parseNumberEnv(env.SYNC_RETRY_DELAY_SECONDS, 30),
    machineAuthEnabled: parseBooleanEnv(
      env.SYNC_MACHINE_AUTH_ENABLED,
      Boolean(machineToken),
    ),
    machineHeaderName: normalizeMachineHeaderName(env.SYNC_MACHINE_HEADER),
    machineToken,
  };
}

export type SyncRuntimeConfig = ReturnType<typeof getSyncRuntimeConfig>;

export const syncConfig = registerAs('sync', () => getSyncRuntimeConfig());
