import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/entities/user.entity';
import {
  type ProfileImageStorageMode,
  type StorageRuntimeConfig,
} from '../config/storage.config';
import { StoragePathService } from './storage-path.service';

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class ProfileImageStorageService {
  constructor(
    private readonly configService: ConfigService,
    private readonly storagePaths: StoragePathService,
  ) {}

  private get runtimeConfig(): StorageRuntimeConfig {
    return this.configService.getOrThrow<StorageRuntimeConfig>('storage');
  }

  get mode(): ProfileImageStorageMode {
    return this.runtimeConfig.profileImageStorageMode;
  }

  private getProfileImageExtension(mimeType?: string | null) {
    return mimeType ? IMAGE_EXTENSION_BY_MIME[mimeType] ?? 'bin' : 'bin';
  }

  private getProfileImageBasename(userId: string | number) {
    return `user-${String(userId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  private buildProfileImagePath(
    userId: string | number,
    mimeType?: string | null,
  ) {
    const extension = this.getProfileImageExtension(mimeType);
    return join(
      this.storagePaths.profileImagesPath,
      `${this.getProfileImageBasename(userId)}.${extension}`,
    );
  }

  private getKnownProfileImagePaths(userId: string | number) {
    const basename = this.getProfileImageBasename(userId);
    return ['jpg', 'png', 'webp', 'bin'].map((extension) =>
      join(this.storagePaths.profileImagesPath, `${basename}.${extension}`),
    );
  }

  private async deleteKnownProfileImageFiles(userId: string | number) {
    await Promise.all(
      this.getKnownProfileImagePaths(userId).map(async (path) => {
        try {
          await fs.unlink(path);
        } catch {
          // ignore missing files
        }
      }),
    );
  }

  async storeProfileImage(user: User, file: Express.Multer.File) {
    if (this.mode === 'filesystem') {
      this.storagePaths.ensureProfileImagesDirectory();
      await this.deleteKnownProfileImageFiles(user.id);

      const imagePath = this.buildProfileImagePath(user.id, file.mimetype);
      await fs.writeFile(imagePath, file.buffer);

      user.profileImageData = null;
      user.profileImageMimeType = file.mimetype;
      return;
    }

    user.profileImageData = file.buffer.toString('base64');
    user.profileImageMimeType = file.mimetype;
  }

  async resolveProfileImageUrl(user: User) {
    if (this.mode === 'filesystem' && user.profileImageMimeType) {
      try {
        const filePath = this.buildProfileImagePath(
          user.id,
          user.profileImageMimeType,
        );
        const buffer = await fs.readFile(filePath);
        return `data:${user.profileImageMimeType};base64,${buffer.toString('base64')}`;
      } catch {
        // fall back to persisted db data or provider avatar
      }
    }

    if (user.profileImageData && user.profileImageMimeType) {
      return `data:${user.profileImageMimeType};base64,${user.profileImageData}`;
    }

    return user.googleAvatarUrl ?? null;
  }
}
