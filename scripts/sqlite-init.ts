import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  process.env.DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
  process.env.DATABASE_SQLITE_PATH =
    process.env.DATABASE_SQLITE_PATH || 'data/econolab-local.sqlite';
  process.env.DATABASE_LOGGING = process.env.DATABASE_LOGGING || 'false';

  const sqlitePath = resolve(process.cwd(), process.env.DATABASE_SQLITE_PATH);

  if (existsSync(sqlitePath)) {
    throw new Error(
      `La base SQLite ya existe en ${sqlitePath}. Usa otra ruta o elimina ese archivo antes de inicializar.`,
    );
  }

  const [{ DataSource }, { migrationDataSourceOptions }] = await Promise.all([
    import('typeorm'),
    import('../src/database/typeorm.datasource'),
  ]);

  const migrationDataSource = new DataSource(migrationDataSourceOptions);

  try {
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    const hasPendingMigrations = await migrationDataSource.showMigrations();

    console.log(
      JSON.stringify(
        {
          ok: true,
          databaseType: process.env.DATABASE_TYPE,
          sqlitePath,
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
