import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository, DataSource, EntityManager } from 'typeorm';
import {
  type SyncRuntimeConfig,
} from '../config/sync.config';
import {
  SyncOutboxEvent,
  SyncOutboxStatus,
} from './entities/sync-outbox-event.entity';
import {
  getSyncTrackedResourceEntity,
  SYNC_TRACKED_RESOURCE_ENTITY_MAP,
} from './sync-resource.util';
import { SYNC_OUTBOX_SKIP_FLAG } from './sync-entity.util';

@Injectable()
export class SyncOutboxService {
  constructor(
    @InjectRepository(SyncOutboxEvent)
    private readonly outboxRepo: Repository<SyncOutboxEvent>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private get runtimeConfig(): SyncRuntimeConfig {
    return this.configService.getOrThrow<SyncRuntimeConfig>('sync');
  }

  get outboxEnabled() {
    return this.runtimeConfig.outboxEnabled;
  }

  private normalizeBatchSize(limit?: number) {
    const requested = Number(limit ?? this.runtimeConfig.outboxBatchSize);

    if (!Number.isFinite(requested) || requested < 1) {
      return 1;
    }

    return Math.min(Math.trunc(requested), 500);
  }

  async listPending(limit = this.runtimeConfig.outboxBatchSize) {
    return this.outboxRepo.find({
      where: {
        status: SyncOutboxStatus.PENDING,
        availableAt: LessThanOrEqual(new Date()),
      },
      order: {
        availableAt: 'ASC',
        id: 'ASC',
      },
      take: Math.max(1, limit),
    });
  }

  async getSummary() {
    const [pending, processing, failed, synced] = await Promise.all([
      this.outboxRepo.count({
        where: {
          status: SyncOutboxStatus.PENDING,
          availableAt: LessThanOrEqual(new Date()),
        },
      }),
      this.outboxRepo.count({
        where: { status: SyncOutboxStatus.PROCESSING },
      }),
      this.outboxRepo.count({
        where: { status: SyncOutboxStatus.FAILED },
      }),
      this.outboxRepo.count({
        where: { status: SyncOutboxStatus.SYNCED },
      }),
    ]);

    const nextAvailable = await this.outboxRepo.findOne({
      where: {
        status: SyncOutboxStatus.PENDING,
        availableAt: LessThanOrEqual(new Date()),
      },
      order: {
        availableAt: 'ASC',
        id: 'ASC',
      },
    });

    return {
      outboxEnabled: this.outboxEnabled,
      counts: {
        pending,
        processing,
        failed,
        synced,
      },
      nextAvailableAt: nextAvailable?.availableAt ?? null,
      resources: await this.getResourceSyncSummary(),
    };
  }

  async claimPendingBatch(limit?: number) {
    const batchSize = this.normalizeBatchSize(limit);
    const leaseToken = randomUUID();
    const now = new Date();

    return this.outboxRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SyncOutboxEvent);
      const candidates = await repo.find({
        select: {
          id: true,
        },
        where: {
          status: SyncOutboxStatus.PENDING,
          availableAt: LessThanOrEqual(now),
        },
        order: {
          availableAt: 'ASC',
          id: 'ASC',
        },
        take: batchSize,
      });

      const ids = candidates.map((candidate) => candidate.id);
      if (ids.length === 0) {
        return {
          leaseToken: null,
          events: [] as SyncOutboxEvent[],
        };
      }

      await repo
        .createQueryBuilder()
        .update(SyncOutboxEvent)
        .set({
          status: SyncOutboxStatus.PROCESSING,
          lastError: null,
          leaseToken,
          leasedAt: now,
        })
        .where('id IN (:...ids)', { ids })
        .andWhere('status = :status', { status: SyncOutboxStatus.PENDING })
        .execute();

      const events = await repo.find({
        where: {
          leaseToken,
          status: SyncOutboxStatus.PROCESSING,
        },
        order: {
          availableAt: 'ASC',
          id: 'ASC',
        },
      });

      return {
        leaseToken: events.length > 0 ? leaseToken : null,
        events,
      };
    });
  }

  private buildLeaseWhere(
    leaseToken: string,
    ids?: number[],
    statuses: SyncOutboxStatus[] = [SyncOutboxStatus.PROCESSING],
  ) {
    return {
      leaseToken,
      status: In(statuses),
      ...(ids && ids.length > 0 ? { id: In(ids) } : {}),
    };
  }

  async markAsSynced(leaseToken: string, ids?: number[]) {
    if (!leaseToken) {
      return { affected: 0 };
    }

    return this.outboxRepo.manager.transaction(async (manager) =>
      this.withSyncSuppressed(manager, async () => {
        const repo = manager.getRepository(SyncOutboxEvent);
        const claimedEvents = await repo.find({
          where: this.buildLeaseWhere(leaseToken, ids),
          order: {
            id: 'ASC',
          },
        });

        if (claimedEvents.length === 0) {
          return { affected: 0 };
        }

        const processedAt = new Date();
        const result = await repo.update(this.buildLeaseWhere(leaseToken, ids), {
          status: SyncOutboxStatus.SYNCED,
          processedAt,
          lastError: null,
          leaseToken: null,
          leasedAt: null,
        });

        await this.markEntitiesAsSynced(manager, claimedEvents, processedAt);

        return {
          affected: result.affected ?? 0,
        };
      }),
    );
  }

  async markAsFailed(
    leaseToken: string,
    id: number,
    errorMessage: string,
  ) {
    if (!leaseToken) {
      return;
    }

    const nextAttemptAt = new Date(
      Date.now() + this.runtimeConfig.retryDelaySeconds * 1000,
    );

    await this.outboxRepo.increment(
      this.buildLeaseWhere(leaseToken, [id]),
      'attempts',
      1,
    );
    await this.outboxRepo.update(
      this.buildLeaseWhere(leaseToken, [id]),
      {
        status: SyncOutboxStatus.FAILED,
        lastError: errorMessage,
        availableAt: nextAttemptAt,
        leaseToken: null,
        leasedAt: null,
      },
    );
  }

  async requeue(ids: number[], includeProcessing = false) {
    if (ids.length === 0) {
      return { affected: 0 };
    }

    const result = await this.outboxRepo.update(
      {
        id: In(ids),
        status: In(
          includeProcessing
            ? [SyncOutboxStatus.FAILED, SyncOutboxStatus.PROCESSING]
            : [SyncOutboxStatus.FAILED],
        ),
      },
      {
        status: SyncOutboxStatus.PENDING,
        lastError: null,
        availableAt: new Date(),
        leaseToken: null,
        leasedAt: null,
        processedAt: null,
      },
    );

    return {
      affected: result.affected ?? 0,
    };
  }

  async requeueAllFailed() {
    const result = await this.outboxRepo.update(
      {
        status: SyncOutboxStatus.FAILED,
      },
      {
        status: SyncOutboxStatus.PENDING,
        lastError: null,
        availableAt: new Date(),
        leaseToken: null,
        leasedAt: null,
        processedAt: null,
      },
    );

    return {
      affected: result.affected ?? 0,
    };
  }

  async discardAllFailed() {
    const result = await this.outboxRepo.delete({
      status: SyncOutboxStatus.FAILED,
    });

    return {
      affected: result.affected ?? 0,
    };
  }

  async requeueFailedReady() {
    const result = await this.outboxRepo.update(
      {
        status: SyncOutboxStatus.FAILED,
        availableAt: LessThanOrEqual(new Date()),
      },
      {
        status: SyncOutboxStatus.PENDING,
        lastError: null,
        leaseToken: null,
        leasedAt: null,
        processedAt: null,
      },
    );

    return {
      affected: result.affected ?? 0,
    };
  }

  async failBatch(
    leaseToken: string,
    failures: Array<{ id: number; error: string }>,
  ) {
    for (const failure of failures) {
      await this.markAsFailed(leaseToken, failure.id, failure.error);
    }

    return {
      affected: failures.length,
    };
  }

  private async withSyncSuppressed<T>(
    manager: EntityManager,
    work: () => Promise<T>,
  ) {
    const queryRunner = manager.queryRunner;
    if (!queryRunner) {
      return work();
    }

    const currentData =
      typeof queryRunner.data === 'object' && queryRunner.data !== null
        ? queryRunner.data
        : {};
    const previousFlag = currentData[SYNC_OUTBOX_SKIP_FLAG];

    currentData[SYNC_OUTBOX_SKIP_FLAG] = true;
    queryRunner.data = currentData;

    try {
      return await work();
    } finally {
      if (previousFlag === undefined) {
        delete currentData[SYNC_OUTBOX_SKIP_FLAG];
      } else {
        currentData[SYNC_OUTBOX_SKIP_FLAG] = previousFlag;
      }

      queryRunner.data = currentData;
    }
  }

  private async markEntitiesAsSynced(
    manager: EntityManager,
    events: SyncOutboxEvent[],
    processedAt: Date,
  ) {
    const latestEventsByResource = new Map<
      string,
      Pick<SyncOutboxEvent, 'resourceType' | 'resourcePublicId' | 'syncVersion'>
    >();

    for (const event of events) {
      const key = `${event.resourceType}:${event.resourcePublicId}`;
      const previous = latestEventsByResource.get(key);

      if (!previous || previous.syncVersion < event.syncVersion) {
        latestEventsByResource.set(key, {
          resourceType: event.resourceType,
          resourcePublicId: event.resourcePublicId,
          syncVersion: event.syncVersion,
        });
      }
    }

    for (const latestEvent of latestEventsByResource.values()) {
      const entity = getSyncTrackedResourceEntity(latestEvent.resourceType);
      if (!entity) {
        continue;
      }

      const repo = manager.getRepository(entity);
      const record = await repo.findOne({
        where: { publicId: latestEvent.resourcePublicId } as never,
      });

      if (!record) {
        continue;
      }

      const currentLastSyncedVersion = Math.max(
        0,
        Number(record.lastSyncedVersion ?? 0),
      );
      const nextLastSyncedVersion = Math.max(
        currentLastSyncedVersion,
        latestEvent.syncVersion,
      );

      if (
        nextLastSyncedVersion === currentLastSyncedVersion &&
        record.lastSyncedAt != null
      ) {
        continue;
      }

      await repo.update(
        { id: record.id } as never,
        {
          lastSyncedVersion: nextLastSyncedVersion,
          lastSyncedAt: processedAt,
        } as never,
      );
    }
  }

  private async getResourceSyncSummary() {
    const entries = Object.entries(SYNC_TRACKED_RESOURCE_ENTITY_MAP);

    const resourceStates = await Promise.all(
      entries.map(async ([resourceType, entity]) => {
        const repo = this.dataSource.getRepository(entity);
        const [total, pendingSyncRows] = await Promise.all([
          repo.count(),
          repo.query(
            `SELECT COUNT(*) AS count
             FROM "${repo.metadata.tableName}"
             WHERE "sync_version" > COALESCE("last_synced_version", 0)`,
          ),
        ]);

        return [
          resourceType,
          {
            total,
            pendingSync: Number(pendingSyncRows[0]?.count ?? 0),
          },
        ] as const;
      }),
    );

    return Object.fromEntries(resourceStates);
  }
}
