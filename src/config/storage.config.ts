import { registerAs } from '@nestjs/config';
import { resolve } from 'node:path';
import { getAppRuntimeConfig } from './app.config';

export type ProfileImageStorageMode = 'database' | 'filesystem';
export type DocumentOutputMode = 'response' | 'filesystem';

function normalizeProfileImageStorageMode(
  value: string | undefined,
  runtimeMode: ReturnType<typeof getAppRuntimeConfig>['runtimeMode'],
): ProfileImageStorageMode {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'database') {
    return 'database';
  }

  if (normalized === 'filesystem') {
    return 'filesystem';
  }

  return runtimeMode === 'web-online' ? 'database' : 'filesystem';
}

function normalizeDocumentOutputMode(value?: string): DocumentOutputMode {
  return value?.trim().toLowerCase() === 'filesystem'
    ? 'filesystem'
    : 'response';
}

export function getStorageRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const { runtimeMode } = getAppRuntimeConfig(env);
  const rootPath = resolve(
    process.cwd(),
    env.APP_STORAGE_ROOT?.trim() || 'data/storage',
  );

  return {
    rootPath,
    runtimeMode,
    profileImageStorageMode: normalizeProfileImageStorageMode(
      env.APP_PROFILE_IMAGE_STORAGE_MODE,
      runtimeMode,
    ),
    documentOutputMode: normalizeDocumentOutputMode(
      env.APP_DOCUMENT_OUTPUT_MODE,
    ),
    profileImagesPath: resolve(rootPath, 'profile-images'),
    documentArtifactsPath: resolve(rootPath, 'documents'),
  };
}

export type StorageRuntimeConfig = ReturnType<typeof getStorageRuntimeConfig>;

export const storageConfig = registerAs('storage', () =>
  getStorageRuntimeConfig(),
);
