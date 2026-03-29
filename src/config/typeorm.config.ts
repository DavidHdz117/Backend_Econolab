import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import {
  buildTypeOrmModuleOptions,
  type DatabaseRuntimeConfig,
} from './database.config';
import { SyncOutboxSubscriber } from '../sync/subscribers/sync-outbox.subscriber';

export const typeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  ...buildTypeOrmModuleOptions(
    configService.getOrThrow<DatabaseRuntimeConfig>('database'),
  ),
  subscribers: [SyncOutboxSubscriber],
});
