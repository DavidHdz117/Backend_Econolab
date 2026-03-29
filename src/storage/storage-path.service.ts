import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageRuntimeConfig } from '../config/storage.config';

@Injectable()
export class StoragePathService {
  constructor(private readonly configService: ConfigService) {}

  private get runtimeConfig(): StorageRuntimeConfig {
    return this.configService.getOrThrow<StorageRuntimeConfig>('storage');
  }

  get rootPath() {
    return this.runtimeConfig.rootPath;
  }

  get profileImagesPath() {
    return this.runtimeConfig.profileImagesPath;
  }

  get documentArtifactsPath() {
    return this.runtimeConfig.documentArtifactsPath;
  }

  ensureDirectory(path: string) {
    mkdirSync(path, { recursive: true });
    return path;
  }

  ensureProfileImagesDirectory() {
    return this.ensureDirectory(this.profileImagesPath);
  }

  ensureDocumentArtifactsDirectory(subdirectory?: string) {
    const path = subdirectory
      ? join(this.documentArtifactsPath, subdirectory)
      : this.documentArtifactsPath;
    return this.ensureDirectory(path);
  }
}
