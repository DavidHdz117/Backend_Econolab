import type { AppRuntimeConfig } from '../config/app.config';
import type { DatabaseRuntimeConfig } from '../config/database.config';
import type { IntegrationRuntimeConfig } from '../config/integrations.config';
import type { StorageRuntimeConfig } from '../config/storage.config';
import type { SyncRuntimeConfig } from '../config/sync.config';

export type RuntimeDiagnosticSeverity = 'error' | 'warning';

export type RuntimeDiagnosticIssue = {
  code: string;
  severity: RuntimeDiagnosticSeverity;
  message: string;
};

type RuntimeDiagnosticsInput = {
  app: AppRuntimeConfig;
  database: DatabaseRuntimeConfig;
  integrations: IntegrationRuntimeConfig;
  storage: StorageRuntimeConfig;
  sync: SyncRuntimeConfig;
  frontendUrlConfigured: boolean;
  mailConfigured: boolean;
  googleAuthConfigured: boolean;
  gmailOauthConfigured: boolean;
};

function addIssue(
  issues: RuntimeDiagnosticIssue[],
  code: string,
  severity: RuntimeDiagnosticSeverity,
  message: string,
) {
  issues.push({ code, severity, message });
}

export function buildRuntimeDiagnostics(input: RuntimeDiagnosticsInput) {
  const {
    app,
    database,
    integrations,
    storage,
    sync,
    frontendUrlConfigured,
    mailConfigured,
    googleAuthConfigured,
    gmailOauthConfigured,
  } = input;

  const issues: RuntimeDiagnosticIssue[] = [];

  if (app.runtimeMode === 'desktop-offline' && database.type !== 'sqlite') {
    addIssue(
      issues,
      'desktop-offline-remote-db',
      'error',
      'desktop-offline sigue apuntando a una base remota. Para trabajo local real conviene SQLite.',
    );
  }

  if (app.runtimeMode !== 'web-online' && database.type === 'postgres') {
    addIssue(
      issues,
      'desktop-runtime-postgres',
      'warning',
      'El runtime desktop sigue dependiendo de PostgreSQL remoto. Esto limita portabilidad y tolerancia offline.',
    );
  }

  if (database.synchronize) {
    addIssue(
      issues,
      'database-synchronize-enabled',
      'warning',
      'DATABASE_SYNCHRONIZE esta activo. Para entornos estables conviene depender de migraciones y no de auto-sync.',
    );
  }

  if (database.logging) {
    addIssue(
      issues,
      'database-logging-enabled',
      'warning',
      'DATABASE_LOGGING esta activo. En hardware modesto agrega I/O y ruido operativo.',
    );
  }

  if (app.runtimeMode !== 'web-online' && app.allowHardDelete) {
    addIssue(
      issues,
      'hard-delete-enabled-on-desktop',
      'warning',
      'APP_ALLOW_HARD_DELETE esta activo en runtime desktop. Eso complica sync y auditoria local.',
    );
  }

  if (app.runtimeMode === 'desktop-offline' && !sync.outboxEnabled) {
    addIssue(
      issues,
      'desktop-offline-outbox-disabled',
      'error',
      'SYNC_OUTBOX_ENABLED esta desactivado en desktop-offline. Los cambios locales no quedarian listos para sincronizar.',
    );
  }

  if (app.runtimeMode === 'desktop-online' && !sync.outboxEnabled) {
    addIssue(
      issues,
      'desktop-online-outbox-disabled',
      'warning',
      'SYNC_OUTBOX_ENABLED esta desactivado en desktop-online. Los cambios locales no se registraran para sync.',
    );
  }

  if (sync.outboxBatchSize > 250 && app.runtimeMode !== 'web-online') {
    addIssue(
      issues,
      'outbox-batch-size-high',
      'warning',
      'SYNC_OUTBOX_BATCH_SIZE es alto para desktop. Un lote mas chico suele ser mas amable con equipos modestos.',
    );
  }

  if (sync.machineAuthEnabled && !sync.machineToken) {
    addIssue(
      issues,
      'sync-machine-auth-misconfigured',
      'error',
      'La autenticacion maquina-a-maquina de sync esta habilitada, pero falta SYNC_MACHINE_TOKEN.',
    );
  }

  if (app.runtimeMode === 'web-online' && !sync.machineAuthEnabled) {
    addIssue(
      issues,
      'sync-machine-auth-disabled',
      'warning',
      'web-online sigue exponiendo sync solo con JWT admin. Conviene habilitar un token dedicado para automatizacion.',
    );
  }

  if (
    app.runtimeMode === 'desktop-offline' &&
    (integrations.mailEnabled ||
      integrations.googleAuthEnabled ||
      integrations.gmailOauthEnabled)
  ) {
    addIssue(
      issues,
      'offline-online-integrations-enabled',
      'warning',
      'desktop-offline mantiene integraciones online activas. Eso puede romper flujos locales o generar errores evitables.',
    );
  }

  if (storage.profileImageStorageMode === 'database' && app.runtimeMode !== 'web-online') {
    addIssue(
      issues,
      'desktop-profile-image-in-db',
      'warning',
      'Las imagenes de perfil siguen en DB en runtime desktop. Filesystem suele ser mas liviano para uso local.',
    );
  }

  if (integrations.mailEnabled && !mailConfigured) {
    addIssue(
      issues,
      'mail-enabled-without-config',
      'warning',
      'El correo esta habilitado pero faltan credenciales de mail.',
    );
  }

  if (integrations.googleAuthEnabled && !googleAuthConfigured) {
    addIssue(
      issues,
      'google-auth-enabled-without-config',
      'warning',
      'Google auth esta habilitado pero faltan credenciales o callback URL.',
    );
  }

  if (integrations.gmailOauthEnabled && !gmailOauthConfigured) {
    addIssue(
      issues,
      'gmail-oauth-enabled-without-config',
      'warning',
      'Gmail OAuth esta habilitado pero faltan credenciales o redirect URI.',
    );
  }

  if (
    frontendUrlConfigured === false &&
    (integrations.mailEnabled ||
      integrations.googleAuthEnabled ||
      integrations.gmailOauthEnabled)
  ) {
    addIssue(
      issues,
      'frontend-url-missing',
      'warning',
      'FRONTEND_URL no esta configurado y hay flujos online habilitados que dependen de enlaces hacia el frontend.',
    );
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter(
    (issue) => issue.severity === 'warning',
  ).length;

  return {
    status: errorCount > 0 ? 'blocked' : warningCount > 0 ? 'attention' : 'ready',
    counts: {
      errors: errorCount,
      warnings: warningCount,
    },
    app: {
      runtimeMode: app.runtimeMode,
      globalPrefix: app.globalPrefix,
      corsEnabled: app.corsEnabled,
      helmetEnabled: app.helmetEnabled,
      allowHardDelete: app.allowHardDelete,
    },
    database: {
      type: database.type,
      synchronize: database.synchronize,
      logging: database.logging,
      sqlitePath: database.type === 'sqlite' ? database.sqlitePath : null,
    },
    integrations: {
      mailEnabled: integrations.mailEnabled,
      mailConfigured,
      googleAuthEnabled: integrations.googleAuthEnabled,
      googleAuthConfigured,
      gmailOauthEnabled: integrations.gmailOauthEnabled,
      gmailOauthConfigured,
      frontendUrlConfigured,
    },
    storage: {
      rootPath: storage.rootPath,
      profileImageStorageMode: storage.profileImageStorageMode,
      documentOutputMode: storage.documentOutputMode,
    },
    sync: {
      outboxEnabled: sync.outboxEnabled,
      defaultOrigin: sync.defaultOrigin,
      outboxBatchSize: sync.outboxBatchSize,
      retryDelaySeconds: sync.retryDelaySeconds,
      machineAuthEnabled: sync.machineAuthEnabled,
      machineHeaderName: sync.machineHeaderName,
      machineTokenConfigured: Boolean(sync.machineToken),
    },
    issues,
  };
}
