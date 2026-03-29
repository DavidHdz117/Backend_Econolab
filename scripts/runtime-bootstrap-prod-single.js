const { mkdirSync, rmSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const request = require('supertest');

async function main() {
  const runtimeMode = process.env.APP_RUNTIME_MODE || 'web-online';

  process.env.DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
  process.env.DATABASE_SQLITE_PATH =
    process.env.DATABASE_SQLITE_PATH ||
    resolve(process.cwd(), 'tmp', `runtime-bootstrap-prod-${runtimeMode}.sqlite`);
  process.env.DATABASE_SYNCHRONIZE = process.env.DATABASE_SYNCHRONIZE || 'false';
  process.env.DATABASE_LOGGING = process.env.DATABASE_LOGGING || 'false';

  mkdirSync(dirname(process.env.DATABASE_SQLITE_PATH), { recursive: true });
  rmSync(process.env.DATABASE_SQLITE_PATH, { force: true });

  const startedAt = Date.now();
  const { createConfiguredApp } = require(
    resolve(process.cwd(), 'dist', 'src', 'main.js'),
  );
  const {
    RuntimeDiagnosticsService,
  } = require(resolve(
    process.cwd(),
    'dist',
    'src',
    'runtime',
    'runtime-diagnostics.service.js',
  ));

  const { app, runtimeConfig } = await createConfiguredApp({
    logger: false,
    abortOnError: false,
  });

  try {
    await app.init();

    const diagnostics = app.get(RuntimeDiagnosticsService).getDiagnostics();
    const prefixPath = runtimeConfig.globalPrefix
      ? `/${runtimeConfig.globalPrefix}`
      : '/';
    const response = await request(app.getHttpServer()).get(prefixPath).expect(200);

    console.log(
      JSON.stringify(
        {
          ok: true,
          runtimeMode,
          status: diagnostics.status,
          bootMs: Date.now() - startedAt,
          rssMb: diagnostics.process.memoryRssMb,
          heapUsedMb: diagnostics.process.memoryHeapUsedMb,
          externalMb: diagnostics.process.memoryExternalMb,
          globalPrefix: runtimeConfig.globalPrefix,
          responseStatus: response.status,
          responseBody: response.text,
          issues: diagnostics.issues.map((issue) => issue.code),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
