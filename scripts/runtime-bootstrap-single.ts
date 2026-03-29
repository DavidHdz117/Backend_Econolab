import { dirname, resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import * as request from 'supertest';

let currentStage = 'start';

async function main() {
  currentStage = 'env';
  const runtimeMode = process.env.APP_RUNTIME_MODE ?? 'web-online';
  process.env.DATABASE_TYPE ??= 'sqlite';
  process.env.DATABASE_SQLITE_PATH ??= resolve(
    process.cwd(),
    'tmp',
    `runtime-bootstrap-${runtimeMode}.sqlite`,
  );
  process.env.DATABASE_SYNCHRONIZE ??= 'false';
  process.env.DATABASE_LOGGING ??= 'false';

  mkdirSync(dirname(process.env.DATABASE_SQLITE_PATH), { recursive: true });
  rmSync(process.env.DATABASE_SQLITE_PATH, { force: true });

  const startedAt = Date.now();
  currentStage = 'imports';
  const { createConfiguredApp } = await import('../src/main');
  const { RuntimeDiagnosticsService } = await import(
    '../src/runtime/runtime-diagnostics.service'
  );

  currentStage = 'create-app';
  const { app, runtimeConfig } = await createConfiguredApp({
    logger: false,
    abortOnError: false,
  });

  try {
    currentStage = 'app-init';
    await app.init();

    currentStage = 'diagnostics';
    const diagnostics = app.get(RuntimeDiagnosticsService).getDiagnostics();
    const prefixPath = runtimeConfig.globalPrefix
      ? `/${runtimeConfig.globalPrefix}`
      : '/';
    currentStage = 'http-request';
    const response = await request(app.getHttpServer()).get(prefixPath).expect(200);

    currentStage = 'stdout';
    console.log(
      JSON.stringify(
        {
          ok: true,
          runtimeMode,
          status: diagnostics.status,
          bootMs: Date.now() - startedAt,
          rssMb: diagnostics.process.memoryRssMb,
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
    currentStage = 'app-close';
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: currentStage,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : null,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
