import 'dotenv/config';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  buildTypeOrmDataSourceOptions,
  getDatabaseRuntimeConfig,
} from '../config/database.config';
import { SyncOutboxSubscriber } from '../sync/subscribers/sync-outbox.subscriber';

const baseDir = __dirname;
const database = getDatabaseRuntimeConfig();

export const migrationDataSourceOptions: DataSourceOptions =
  {
    ...buildTypeOrmDataSourceOptions(
      database,
      [join(baseDir, '..', '**', '*.entity.{ts,js}')],
      [join(baseDir, 'migrations', '[0-9]*-*.{ts,js}')],
    ),
    subscribers: [SyncOutboxSubscriber],
  };

const appDataSource = new DataSource(migrationDataSourceOptions);

export default appDataSource;
