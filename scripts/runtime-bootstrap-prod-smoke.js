const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runScenario(runtimeMode) {
  const scriptPath = resolve(
    process.cwd(),
    'scripts',
    'runtime-bootstrap-prod-single.js',
  );
  const env = {
    ...process.env,
    APP_RUNTIME_MODE: runtimeMode,
    DATABASE_TYPE: 'sqlite',
    DATABASE_SQLITE_PATH: resolve(
      process.cwd(),
      'tmp',
      `runtime-bootstrap-prod-${runtimeMode}.sqlite`,
    ),
    DATABASE_SYNCHRONIZE: 'false',
    DATABASE_LOGGING: 'false',
    SYNC_MACHINE_TOKEN: `${runtimeMode}-sync-token`,
    FRONTEND_URL:
      runtimeMode === 'desktop-offline'
        ? process.env.FRONTEND_URL
        : 'http://localhost:5173',
    GMAIL_USER:
      runtimeMode === 'desktop-offline' ? process.env.GMAIL_USER : 'mail@example.com',
    GMAIL_PASS:
      runtimeMode === 'desktop-offline' ? process.env.GMAIL_PASS : 'secret',
    GOOGLE_CLIENT_ID:
      runtimeMode === 'desktop-offline'
        ? process.env.GOOGLE_CLIENT_ID
        : 'client-id',
    GOOGLE_CLIENT_SECRET:
      runtimeMode === 'desktop-offline'
        ? process.env.GOOGLE_CLIENT_SECRET
        : 'client-secret',
    GOOGLE_CALLBACK_URL:
      runtimeMode === 'desktop-offline'
        ? process.env.GOOGLE_CALLBACK_URL
        : 'http://localhost:3000/api/auth/google/callback',
    GOOGLE_REDIRECT_URI:
      runtimeMode === 'desktop-offline'
        ? process.env.GOOGLE_REDIRECT_URI
        : 'http://localhost:3000/api/auth/gmail/callback',
  };

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `Fallo el bootstrap prod smoke para ${runtimeMode}: ${result.stderr || result.stdout}`,
    );
  }

  return JSON.parse(result.stdout);
}

async function main() {
  const scenarios = [
    runScenario('web-online'),
    runScenario('desktop-online'),
    runScenario('desktop-offline'),
  ];

  for (const scenario of scenarios) {
    assert(
      scenario.status === 'ready',
      `El runtime ${scenario.runtimeMode} debio bootear en estado ready.`,
    );
    assert(
      scenario.responseBody === 'Backend Sistema 50TA',
      `La ruta raiz no respondio como se esperaba en ${scenario.runtimeMode}.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scenarios: scenarios.map((scenario) => ({
          runtimeMode: scenario.runtimeMode,
          status: scenario.status,
          bootMs: scenario.bootMs,
          rssMb: scenario.rssMb,
          heapUsedMb: scenario.heapUsedMb,
          externalMb: scenario.externalMb,
          issues: scenario.issues,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
