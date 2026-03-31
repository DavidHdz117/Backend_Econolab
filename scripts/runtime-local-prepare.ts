import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

async function main() {
  process.env.DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
  process.env.DATABASE_SQLITE_PATH =
    process.env.DATABASE_SQLITE_PATH || 'data/econolab-local.sqlite';
  process.env.DATABASE_LOGGING = process.env.DATABASE_LOGGING || 'false';
  process.env.DATABASE_SYNCHRONIZE = process.env.DATABASE_SYNCHRONIZE || 'false';

  const sqlitePath = resolve(process.cwd(), process.env.DATABASE_SQLITE_PATH);
  mkdirSync(dirname(sqlitePath), { recursive: true });

  const [{ DataSource }, { migrationDataSourceOptions }] = await Promise.all([
    import('typeorm'),
    import('../src/database/typeorm.datasource'),
  ]);

  const migrationDataSource = new DataSource(migrationDataSourceOptions);

  try {
    await migrationDataSource.initialize();
    const executedMigrations = await migrationDataSource.runMigrations();
    const hasPendingMigrations = await migrationDataSource.showMigrations();

    console.log(
      JSON.stringify(
        {
          ok: true,
          databaseType: process.env.DATABASE_TYPE,
          sqlitePath,
          executedMigrations: executedMigrations.length,
          hasPendingMigrations,
        },
        null,
        2,
      ),
    );
  } finally {
    if (migrationDataSource.isInitialized) {
      await migrationDataSource.destroy();
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
