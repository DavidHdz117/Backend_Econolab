import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cpus, freemem, totalmem } from 'node:os';
import type { AppRuntimeConfig } from '../config/app.config';
import type { DatabaseRuntimeConfig } from '../config/database.config';
import type { IntegrationRuntimeConfig } from '../config/integrations.config';
import type { StorageRuntimeConfig } from '../config/storage.config';
import type { SyncRuntimeConfig } from '../config/sync.config';
import { IntegrationPolicyService } from './integration-policy.service';
import { buildRuntimeDiagnostics } from './runtime-diagnostics.util';

@Injectable()
export class RuntimeDiagnosticsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly integrationPolicy: IntegrationPolicyService,
  ) {}

  private get appRuntimeConfig(): AppRuntimeConfig {
    return this.configService.getOrThrow<AppRuntimeConfig>('app');
  }

  private get databaseRuntimeConfig(): DatabaseRuntimeConfig {
    return this.configService.getOrThrow<DatabaseRuntimeConfig>('database');
  }

  private get integrationRuntimeConfig(): IntegrationRuntimeConfig {
    return this.configService.getOrThrow<IntegrationRuntimeConfig>('integrations');
  }

  private get storageRuntimeConfig(): StorageRuntimeConfig {
    return this.configService.getOrThrow<StorageRuntimeConfig>('storage');
  }

  private get syncRuntimeConfig(): SyncRuntimeConfig {
    return this.configService.getOrThrow<SyncRuntimeConfig>('sync');
  }

  getDiagnostics() {
    const memoryUsage = process.memoryUsage();
    const diagnostics = buildRuntimeDiagnostics({
      app: this.appRuntimeConfig,
      database: this.databaseRuntimeConfig,
      integrations: this.integrationRuntimeConfig,
      storage: this.storageRuntimeConfig,
      sync: this.syncRuntimeConfig,
      frontendUrlConfigured: Boolean(this.integrationPolicy.frontendUrl),
      mailConfigured: this.integrationPolicy.mailConfigured,
      googleAuthConfigured: this.integrationPolicy.googleAuthConfigured,
      gmailOauthConfigured: this.integrationPolicy.gmailOauthConfigured,
    });

    return {
      ...diagnostics,
      generatedAt: new Date().toISOString(),
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSeconds: Math.round(process.uptime()),
        memoryRssMb: Math.round(memoryUsage.rss / (1024 * 1024)),
        memoryHeapUsedMb: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
        memoryExternalMb: Math.round(memoryUsage.external / (1024 * 1024)),
      },
      host: {
        cpuCount: cpus().length,
        totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
        freeMemoryMb: Math.round(freemem() / (1024 * 1024)),
      },
    };
  }
}
