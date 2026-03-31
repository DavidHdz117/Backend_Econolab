import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, EntityMetadata, ObjectLiteral } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { SyncRuntimeConfig } from '../config/sync.config';
import { SyncOutboxOperation } from './entities/sync-outbox-event.entity';
import {
  buildPortableSyncPayload,
  getSyncTrackedResourceEntity,
  SUPPORTED_INBOUND_SYNC_RESOURCES,
  type SupportedInboundSyncResourceType,
} from './sync-resource.util';
import type { SyncInboundMutationInput } from './dto/apply-sync-mutations.dto';

function toBoolean(value: boolean | undefined, defaultValue: boolean) {
  return value ?? defaultValue;
}

@Injectable()
export class SyncBootstrapService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  private get runtimeConfig(): SyncRuntimeConfig {
    return this.configService.getOrThrow<SyncRuntimeConfig>('sync');
  }

  private normalizeLimit(limit?: number) {
    const requested = Number(limit ?? this.runtimeConfig.bootstrapBatchSize);

    if (!Number.isFinite(requested) || requested < 1) {
      return 1;
    }

    return Math.min(Math.trunc(requested), 1000);
  }

  private serializeValue(value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        this.serializeValue(nestedValue),
      ]),
    );
  }

  private async buildPayload(
    metadata: EntityMetadata,
    resourceType: string,
    manager: EntityManager,
    entity: ObjectLiteral,
  ) {
    const payload = Object.fromEntries(
      metadata.columns
        .filter((column) => !column.isVirtual)
        .map((column) => [
          column.propertyName,
          this.serializeValue(column.getEntityValue(entity)),
        ]),
    );

    return buildPortableSyncPayload(resourceType, payload, manager);
  }

  async exportResourcePage(
    resourceType: SupportedInboundSyncResourceType,
    options?: {
      cursor?: string;
      limit?: number;
      includeDeleted?: boolean;
    },
  ) {
    const entity = getSyncTrackedResourceEntity(resourceType);
    if (!entity) {
      throw new Error(`Recurso ${resourceType} no soportado para bootstrap.`);
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(entity);
      const metadata = repo.metadata;
      const primaryColumn = metadata.primaryColumns[0];
      const primaryProperty = primaryColumn?.propertyPath;
      const alias = metadata.tableName;

      if (!primaryColumn || !primaryProperty) {
        throw new Error(
          `El recurso ${resourceType} no tiene una clave primaria util para bootstrap.`,
        );
      }

      const includeDeleted = toBoolean(options?.includeDeleted, true);
      const limit = this.normalizeLimit(options?.limit);
      const qb = repo.createQueryBuilder(alias);

      qb.orderBy(`${alias}.${primaryProperty}`, 'ASC');

      if (options?.cursor) {
        qb.andWhere(`${alias}.${primaryProperty} > :cursor`, {
          cursor: options.cursor,
        });
      }

      if (!includeDeleted && metadata.columns.some((column) => column.propertyName === 'deletedAt')) {
        qb.andWhere(`${alias}.deletedAt IS NULL`);
      }

      qb.take(limit);

      const rows = await qb.getMany();

      const mutations: SyncInboundMutationInput[] = [];
      for (const row of rows) {
        const payload = await this.buildPayload(metadata, resourceType, manager, row);
        const operation =
          (row as { deletedAt?: Date | null }).deletedAt != null
            ? SyncOutboxOperation.DELETE
            : SyncOutboxOperation.UPSERT;

        mutations.push({
          resourceType,
          operation,
          payload,
        });
      }

      const lastRow = rows.at(-1) as ObjectLiteral | undefined;
      const nextCursor = lastRow
        ? String(primaryColumn.getEntityValue(lastRow))
        : null;

      return {
        resourceType,
        count: mutations.length,
        hasMore: rows.length === limit,
        nextCursor,
        mutations,
      };
    });
  }

  getSupportedResources() {
    return [...SUPPORTED_INBOUND_SYNC_RESOURCES];
  }
}
