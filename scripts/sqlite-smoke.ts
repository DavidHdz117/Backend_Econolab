import 'reflect-metadata';
import { resolve } from 'node:path';

async function main() {
  process.env.DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
  process.env.DATABASE_SQLITE_PATH =
    process.env.DATABASE_SQLITE_PATH || 'tmp/econolab-smoke.sqlite';
  process.env.DATABASE_LOGGING = process.env.DATABASE_LOGGING || 'false';

  const [{ DataSource }, { migrationDataSourceOptions }] = await Promise.all([
    import('typeorm'),
    import('../src/database/typeorm.datasource'),
  ]);

  const dataSource = new DataSource(migrationDataSourceOptions);

  try {
    await dataSource.initialize();
    const hasPendingMigrations = await dataSource.showMigrations();

    console.log(
      JSON.stringify(
        {
          ok: true,
          databaseType: process.env.DATABASE_TYPE,
          sqlitePath: resolve(process.cwd(), process.env.DATABASE_SQLITE_PATH),
          hasPendingMigrations,
        },
        null,
        2,
      ),
    );
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
