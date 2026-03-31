import { registerAs } from '@nestjs/config';
import {
  parseBooleanEnv,
  parseNumberEnv,
  parseOptionalStringEnv,
  parseStringListEnv,
} from './env.utils';

export type AppRuntimeMode =
  | 'web-online'
  | 'desktop-online'
  | 'desktop-offline';

const DEFAULT_CORS_ORIGINS = [
  'https://econolab.netlify.app',
  'http://localhost:5173',
];

function normalizeRuntimeMode(value?: string): AppRuntimeMode {
  switch (value?.trim().toLowerCase()) {
    case 'desktop-online':
      return 'desktop-online';
    case 'desktop-offline':
      return 'desktop-offline';
    case 'web-online':
    default:
      return 'web-online';
  }
}

export function getAppRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const runtimeMode = normalizeRuntimeMode(env.APP_RUNTIME_MODE);

  return {
    runtimeMode,
    globalPrefix: env.APP_GLOBAL_PREFIX?.trim() || 'api',
    port: parseNumberEnv(env.PORT, 3000),
    host: parseOptionalStringEnv(env.HOST),
    helmetEnabled: parseBooleanEnv(env.APP_HELMET_ENABLED, true),
    corsEnabled: parseBooleanEnv(env.APP_CORS_ENABLED, true),
    allowHardDelete: parseBooleanEnv(
      env.APP_ALLOW_HARD_DELETE,
      runtimeMode === 'web-online',
    ),
    corsOrigins: parseStringListEnv(
      env.APP_CORS_ORIGINS,
      DEFAULT_CORS_ORIGINS,
    ),
  };
}

export type AppRuntimeConfig = ReturnType<typeof getAppRuntimeConfig>;

export const appConfig = registerAs('app', () => getAppRuntimeConfig());
