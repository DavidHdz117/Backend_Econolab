import 'dotenv/config';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';

const baseDir = __dirname;

export const migrationDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASS,
  database: process.env.DATABASE_NAME,
  ssl: true,
  logging: true,
  synchronize: false,
  entities: [join(baseDir, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(baseDir, 'migrations', '*.{ts,js}')],
};

const appDataSource = new DataSource(migrationDataSourceOptions);

export default appDataSource;
