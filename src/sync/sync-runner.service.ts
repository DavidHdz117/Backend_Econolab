import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { SyncRuntimeConfig } from '../config/sync.config';
import type { SyncInboundMutationInput } from './dto/apply-sync-mutations.dto';
import { SyncRemoteClientService } from './sync-remote-client.service';
import { SyncBootstrapService } from './sync-bootstrap.service';
import { SyncInboundService } from './sync-inbound.service';
import { SyncOutboxService } from './sync-outbox.service';
import {
  SUPPORTED_INBOUND_SYNC_RESOURCES,
  getSyncTrackedResourceEntity,
  type SupportedInboundSyncResourceType,
} from './sync-resource.util';

type ApplyResultStatus =
  | 'applied'
  | 'skipped_stale'
  | 'skipped_duplicate'
  | 'deferred_missing_dependency'
  | 'failed'
  | 'unsupported_resource';

type BootstrapSummary = Array<{
  resourceType: SupportedInboundSyncResourceType;
  exported: number;
  applied: number;
  skipped: number;
  deferred: number;
  failed: number;
  pages: number;
}>;

function isSuccessfulApplyStatus(status: string): status is ApplyResultStatus {
  return ['applied', 'skipped_stale', 'skipped_duplicate'].includes(status);
}

@Injectable()
export class SyncRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncRunnerService.name);
  private autoInterval: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunAt: string | null = null;
  private lastRunResult: Record<string, unknown> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly syncOutbox: SyncOutboxService,
    private readonly syncInbound: SyncInboundService,
    private readonly syncBootstrap: SyncBootstrapService,
    private readonly syncRemoteClient: SyncRemoteClientService,
  ) {}

  private get runtimeConfig(): SyncRuntimeConfig {
    return this.configService.getOrThrow<SyncRuntimeConfig>('sync');
  }

  private get autoSyncEnabled() {
    return this.runtimeConfig.autoEnabled && Boolean(this.runtimeConfig.remoteBaseUrl);
  }

  private get startupSyncEnabled() {
    return Boolean(this.runtimeConfig.remoteBaseUrl);
  }

  onModuleInit() {
    if (!this.startupSyncEnabled) {
      return;
    }

    this.startupTimer = setTimeout(() => {
      void this.runStartupSync().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`La sincronizacion inicial fallo: ${message}`);
      });
    }, 1500);

    if (!this.autoSyncEnabled) {
      return;
    }

    const intervalMs = Math.max(5, this.runtimeConfig.autoIntervalSeconds) * 1000;

    this.autoInterval = setInterval(() => {
      void this.runOnce({
        reason: 'interval',
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`La sincronizacion automatica fallo: ${message}`);
      });
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }

    if (this.autoInterval) {
      clearInterval(this.autoInterval);
      this.autoInterval = null;
    }
  }

  getStatus() {
    return {
      running: this.running,
      autoEnabled: this.autoSyncEnabled,
      startupEnabled: this.startupSyncEnabled,
      remoteBaseUrlConfigured: Boolean(this.runtimeConfig.remoteBaseUrl),
      autoIntervalSeconds: this.runtimeConfig.autoIntervalSeconds,
      lastRunAt: this.lastRunAt,
      lastRunResult: this.lastRunResult,
    };
  }

  private async getLocalResourceCounts() {
    const counts = {} as Record<SupportedInboundSyncResourceType, number>;

    for (const resourceType of SUPPORTED_INBOUND_SYNC_RESOURCES) {
      const entity = getSyncTrackedResourceEntity(resourceType);
      if (!entity) {
        counts[resourceType] = 0;
        continue;
      }

      counts[resourceType] = await this.dataSource.getRepository(entity).count();
    }

    return counts;
  }

  private async resolveBootstrapResourceTypes() {
    const counts = await this.getLocalResourceCounts();
    const totalTrackedRecords = Object.values(counts).reduce(
      (accumulator, value) => accumulator + value,
      0,
    );

    if (totalTrackedRecords === 0) {
      return [...SUPPORTED_INBOUND_SYNC_RESOURCES];
    }

    if (counts.users === 0) {
      return ['users'] as SupportedInboundSyncResourceType[];
    }

    return [] as SupportedInboundSyncResourceType[];
  }

  private async runStartupSync() {
    const bootstrapResourceTypes = await this.resolveBootstrapResourceTypes();
    let bootstrapResult:
      | {
          status: 'skipped';
          resourceTypes: SupportedInboundSyncResourceType[];
        }
      | ({
          status: 'completed';
          resourceTypes: SupportedInboundSyncResourceType[];
          remoteBaseUrl: string | undefined;
          resources: BootstrapSummary;
          totals: {
            exported: number;
            applied: number;
            skipped: number;
            deferred: number;
            failed: number;
          };
        })
      | {
          status: 'failed';
          resourceTypes: SupportedInboundSyncResourceType[];
          message: string;
        };

    if (bootstrapResourceTypes.length > 0) {
      try {
        const result = await this.bootstrapFromRemote({
          resourceTypes: bootstrapResourceTypes,
          includeDeleted: true,
        });
        bootstrapResult = {
          status: 'completed',
          resourceTypes: bootstrapResourceTypes,
          ...result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const result = {
          status: 'bootstrap_failed',
          reason: 'startup',
          remoteBaseUrl: this.runtimeConfig.remoteBaseUrl,
          bootstrap: {
            status: 'failed',
            resourceTypes: bootstrapResourceTypes,
            message,
          },
          sync: null,
        };

        this.lastRunAt = new Date().toISOString();
        this.lastRunResult = result;

        return result;
      }
    } else {
      bootstrapResult = {
        status: 'skipped',
        resourceTypes: [],
      };
    }

    const syncResult = await this.runOnce({
      reason: 'startup',
    });
    const result = {
      status: 'startup_completed',
      reason: 'startup',
      remoteBaseUrl: this.runtimeConfig.remoteBaseUrl,
      bootstrap: bootstrapResult,
      sync: syncResult,
    };

    this.lastRunAt = new Date().toISOString();
    this.lastRunResult = result;

    return result;
  }

  async bootstrapFromRemote(options?: {
    resourceTypes?: string[];
    limit?: number;
    includeDeleted?: boolean;
  }) {
    if (!this.runtimeConfig.remoteBaseUrl) {
      throw new Error(
        'SYNC_REMOTE_BASE_URL no esta configurado. No se puede hacer bootstrap remoto.',
      );
    }

    const resourceTypes = (
      options?.resourceTypes?.length
        ? options.resourceTypes
        : [...SUPPORTED_INBOUND_SYNC_RESOURCES]
    ).filter(
      (resourceType): resourceType is SupportedInboundSyncResourceType =>
        (SUPPORTED_INBOUND_SYNC_RESOURCES as readonly string[]).includes(resourceType),
    );

    const summary: Array<{
      resourceType: SupportedInboundSyncResourceType;
      exported: number;
      applied: number;
      skipped: number;
      deferred: number;
      failed: number;
      pages: number;
    }> = [];

    for (const resourceType of resourceTypes) {
      let cursor: string | undefined;
      let pages = 0;
      let exported = 0;
      let applied = 0;
      let skipped = 0;
      let deferred = 0;
      let failed = 0;

      do {
        const page = await this.syncRemoteClient.exportBootstrapPage({
          resourceType,
          cursor,
          limit: options?.limit,
          includeDeleted: options?.includeDeleted,
        });

        pages += 1;
        exported += page.count;

        if (page.mutations.length > 0) {
          const applyResult = await this.syncInbound.applyBatch(page.mutations);
          applied += applyResult.appliedCount;
          skipped += applyResult.skippedCount;
          deferred += applyResult.deferredCount;
          failed += applyResult.failedCount;
        }

        cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
      } while (cursor);

      summary.push({
        resourceType,
        exported,
        applied,
        skipped,
        deferred,
        failed,
        pages,
      });
    }

    return {
      remoteBaseUrl: this.runtimeConfig.remoteBaseUrl,
      resources: summary,
      totals: {
        exported: summary.reduce((acc, item) => acc + item.exported, 0),
        applied: summary.reduce((acc, item) => acc + item.applied, 0),
        skipped: summary.reduce((acc, item) => acc + item.skipped, 0),
        deferred: summary.reduce((acc, item) => acc + item.deferred, 0),
        failed: summary.reduce((acc, item) => acc + item.failed, 0),
      },
    };
  }

  async runOnce(options?: { pushLimit?: number; pullLimit?: number; reason?: string }) {
    if (!this.runtimeConfig.remoteBaseUrl) {
      const result = {
        status: 'skipped_not_configured',
        message:
          'SYNC_REMOTE_BASE_URL no esta configurado. No se puede correr sincronizacion remota.',
      };
      this.lastRunAt = new Date().toISOString();
      this.lastRunResult = result;
      return result;
    }

    if (this.running) {
      return {
        status: 'skipped_already_running',
        message: 'Ya hay una sincronizacion en curso.',
      };
    }

    this.running = true;
    let pushResult:
      | {
          claimed: number;
          synced: number;
          failed: number;
          error?: string;
        }
      | undefined;
    let pullResult:
      | {
          claimed: number;
          synced: number;
          failed: number;
          error?: string;
        }
      | undefined;
    const reason = options?.reason ?? 'manual';

    try {
      if (reason === 'manual') {
        await this.syncOutbox.requeueAllFailed();
      } else {
        await this.syncOutbox.requeueFailedReady();
      }

      pushResult = await this.pushPendingBatch(options?.pushLimit);
      pullResult = await this.pullPendingBatch(options?.pullLimit);
      const result = {
        status: 'completed',
        reason,
        remoteBaseUrl: this.runtimeConfig.remoteBaseUrl,
        push: pushResult,
        pull: pullResult,
      };

      this.lastRunAt = new Date().toISOString();
      this.lastRunResult = result;

      return result;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo completar la sincronizacion remota.';
      const result = {
        status: 'failed',
        reason,
        remoteBaseUrl: this.runtimeConfig.remoteBaseUrl,
        push: pushResult,
        pull: pullResult,
        message,
      };

      this.lastRunAt = new Date().toISOString();
      this.lastRunResult = result;

      return result;
    } finally {
      this.running = false;
    }
  }

  private async pushPendingBatch(limit?: number) {
    const claimed = await this.syncOutbox.claimPendingBatch(limit);
    if (!claimed.leaseToken || claimed.events.length === 0) {
      return {
        claimed: 0,
        synced: 0,
        failed: 0,
      };
    }

    try {
      const mutations = claimed.events.map(
        (event): SyncInboundMutationInput => ({
          resourceType: event.resourceType,
          operation: event.operation,
          payload: event.payload,
        }),
      );
      const remoteApplyResult = await this.syncRemoteClient.applyInbound(mutations);
      const successfulIds: number[] = [];
      const failures: Array<{ id: number; error: string }> = [];

      for (const result of remoteApplyResult.results) {
        const event = claimed.events[result.index];
        if (!event) {
          continue;
        }

        if (isSuccessfulApplyStatus(result.status)) {
          successfulIds.push(event.id);
          continue;
        }

        failures.push({
          id: event.id,
          error: result.message,
        });
      }

      if (successfulIds.length > 0) {
        await this.syncOutbox.markAsSynced(claimed.leaseToken, successfulIds);
      }

      if (failures.length > 0) {
        await this.syncOutbox.failBatch(claimed.leaseToken, failures);
      }

      return {
        claimed: claimed.events.length,
        synced: successfulIds.length,
        failed: failures.length,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar el lote remoto.';
      await this.syncOutbox.failBatch(
        claimed.leaseToken,
        claimed.events.map((event) => ({
          id: event.id,
          error: message,
        })),
      );

      return {
        claimed: claimed.events.length,
        synced: 0,
        failed: claimed.events.length,
        error: message,
      };
    }
  }

  private async pullPendingBatch(limit?: number) {
    const claimed = await this.syncRemoteClient.claimPendingBatch(limit);
    if (!claimed.leaseToken || claimed.events.length === 0) {
      return {
        claimed: 0,
        synced: 0,
        failed: 0,
      };
    }

    try {
      const mutations = claimed.events.map(
        (event): SyncInboundMutationInput => ({
          resourceType: event.resourceType,
          operation: event.operation,
          payload: event.payload,
        }),
      );
      const localApplyResult = await this.syncInbound.applyBatch(mutations);
      const successfulIds: number[] = [];
      const failures: Array<{ id: number; error: string }> = [];

      for (const result of localApplyResult.results) {
        const event = claimed.events[result.index];
        if (!event) {
          continue;
        }

        if (isSuccessfulApplyStatus(result.status)) {
          successfulIds.push(event.id);
          continue;
        }

        failures.push({
          id: event.id,
          error: result.message,
        });
      }

      if (successfulIds.length > 0) {
        await this.syncRemoteClient.ackBatch(claimed.leaseToken, successfulIds);
      }

      if (failures.length > 0) {
        await this.syncRemoteClient.failBatch(claimed.leaseToken, failures);
      }

      return {
        claimed: claimed.events.length,
        synced: successfulIds.length,
        failed: failures.length,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo aplicar el lote remoto.';
      await this.syncRemoteClient.failBatch(
        claimed.leaseToken,
        claimed.events.map((event) => ({
          id: event.id,
          error: message,
        })),
      );

      return {
        claimed: claimed.events.length,
        synced: 0,
        failed: claimed.events.length,
        error: message,
      };
    }
  }
}
