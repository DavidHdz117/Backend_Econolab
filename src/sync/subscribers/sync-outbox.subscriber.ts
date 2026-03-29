import {
  EventSubscriber,
  type EntityMetadata,
  type EntitySubscriberInterface,
  type InsertEvent,
  type ObjectLiteral,
  type RemoveEvent,
  type UpdateEvent,
} from 'typeorm';
import { getSyncRuntimeConfig } from '../../config/sync.config';
import {
  SyncOutboxEvent,
  SyncOutboxOperation,
  SyncOutboxStatus,
} from '../entities/sync-outbox-event.entity';
import { buildPortableSyncPayload } from '../sync-resource.util';
import { SYNC_OUTBOX_SKIP_FLAG } from '../sync-entity.util';

const OUTBOX_RECURSION_FLAG = '__syncOutboxWriting__';
const IGNORED_UPDATE_COLUMNS = new Set(['lastSyncedAt', 'lastSyncedVersion']);

type SyncTrackedSnapshot = {
  publicId: string;
  syncVersion: number;
  syncOrigin: string | null;
  deletedAt?: unknown;
  id?: unknown;
};

@EventSubscriber()
export class SyncOutboxSubscriber implements EntitySubscriberInterface {
  async afterInsert(event: InsertEvent<ObjectLiteral>) {
    await this.enqueueMutation(event, SyncOutboxOperation.UPSERT);
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>) {
    if (this.shouldIgnoreUpdate(event)) {
      return;
    }

    const snapshot = this.getTrackedSnapshot(
      event.metadata,
      event.entity,
      event.databaseEntity,
    );

    if (!snapshot) {
      return;
    }

    const previousDeletedAt = (event.databaseEntity as SyncTrackedSnapshot | null)
      ?.deletedAt;
    const nextDeletedAt = snapshot.deletedAt;
    const operation =
      previousDeletedAt == null && nextDeletedAt != null
        ? SyncOutboxOperation.DELETE
        : SyncOutboxOperation.UPSERT;

    await this.enqueueMutation(event, operation, snapshot);
  }

  async afterRemove(event: RemoveEvent<ObjectLiteral>) {
    const snapshot = this.getTrackedSnapshot(
      event.metadata,
      event.entity,
      event.databaseEntity,
    );

    if (snapshot?.deletedAt != null) {
      return;
    }

    await this.enqueueMutation(
      event,
      SyncOutboxOperation.DELETE,
      snapshot,
    );
  }

  private shouldTrackOutbox() {
    return getSyncRuntimeConfig().outboxEnabled;
  }

  private isTrackedMetadata(metadata: EntityMetadata) {
    if (metadata.tableName === 'sync_outbox_events') {
      return false;
    }

    const propertyNames = new Set(metadata.columns.map((column) => column.propertyName));

    return (
      propertyNames.has('publicId') &&
      propertyNames.has('syncVersion') &&
      propertyNames.has('syncOrigin')
    );
  }

  private getTrackedSnapshot(
    metadata: EntityMetadata,
    entity?: ObjectLiteral | null,
    databaseEntity?: ObjectLiteral | null,
  ): SyncTrackedSnapshot | null {
    if (!this.isTrackedMetadata(metadata)) {
      return null;
    }

    const source = entity ?? databaseEntity;
    if (!source) {
      return null;
    }

    const publicId = this.getColumnValue<string | null>(
      metadata,
      'publicId',
      source,
      databaseEntity,
    );

    if (!publicId) {
      return null;
    }

    return {
      id: this.getPrimaryValue(metadata, source, databaseEntity),
      publicId,
      syncVersion:
        Number(
          this.getColumnValue<number | string | null>(
            metadata,
            'syncVersion',
            source,
            databaseEntity,
          ),
        ) || 1,
      syncOrigin:
        this.getColumnValue<string | null>(
          metadata,
          'syncOrigin',
          source,
          databaseEntity,
        ) ?? null,
      deletedAt: this.getColumnValue(
        metadata,
        'deletedAt',
        source,
        databaseEntity,
      ),
    };
  }

  private getPrimaryValue(
    metadata: EntityMetadata,
    source: ObjectLiteral,
    fallback?: ObjectLiteral | null,
  ) {
    const primaryColumn = metadata.primaryColumns[0];
    if (!primaryColumn) {
      return undefined;
    }

    const primaryValue =
      primaryColumn.getEntityValue(source) ??
      (fallback ? primaryColumn.getEntityValue(fallback) : undefined);

    return primaryValue;
  }

  private getColumnValue<T>(
    metadata: EntityMetadata,
    propertyName: string,
    source: ObjectLiteral,
    fallback?: ObjectLiteral | null,
  ) {
    const column = metadata.columns.find(
      (candidate) => candidate.propertyName === propertyName,
    );
    if (!column) {
      return undefined;
    }

    return (
      column.getEntityValue(source) ??
      (fallback ? column.getEntityValue(fallback) : undefined)
    ) as T | undefined;
  }

  private shouldIgnoreUpdate(event: UpdateEvent<ObjectLiteral>) {
    if (!this.isTrackedMetadata(event.metadata)) {
      return true;
    }

    if (event.updatedColumns.length === 0) {
      return false;
    }

    return event.updatedColumns.every((column) =>
      IGNORED_UPDATE_COLUMNS.has(column.propertyName),
    );
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

    const serializedEntries = Object.entries(value).map(([key, nestedValue]) => [
      key,
      this.serializeValue(nestedValue),
    ]);

    return Object.fromEntries(serializedEntries);
  }

  private async buildPayload(
    metadata: EntityMetadata,
    resourceType: string,
    manager: InsertEvent<ObjectLiteral>['manager'],
    entity?: ObjectLiteral | null,
    databaseEntity?: ObjectLiteral | null,
  ) {
    const source = entity ?? databaseEntity;
    if (!source) {
      return {};
    }

    const payload = Object.fromEntries(
      metadata.columns
        .filter((column) => !column.isVirtual)
        .map((column) => {
          const value =
            column.getEntityValue(source) ??
            (databaseEntity ? column.getEntityValue(databaseEntity) : undefined);

          return [column.propertyName, this.serializeValue(value)];
        }),
    );

    return buildPortableSyncPayload(resourceType, payload, manager);
  }

  private getEventDatabaseEntity(
    event:
      | InsertEvent<ObjectLiteral>
      | UpdateEvent<ObjectLiteral>
      | RemoveEvent<ObjectLiteral>,
  ) {
    if ('databaseEntity' in event) {
      return event.databaseEntity;
    }

    return undefined;
  }

  private async enqueueMutation(
    event:
      | InsertEvent<ObjectLiteral>
      | UpdateEvent<ObjectLiteral>
      | RemoveEvent<ObjectLiteral>,
    operation: SyncOutboxOperation,
    providedSnapshot?: SyncTrackedSnapshot | null,
  ) {
    if (!this.shouldTrackOutbox()) {
      return;
    }

    const { queryRunner, metadata } = event;
    const queryRunnerData =
      typeof queryRunner.data === 'object' && queryRunner.data !== null
        ? queryRunner.data
        : {};

    if (
      queryRunnerData[OUTBOX_RECURSION_FLAG] ||
      queryRunnerData[SYNC_OUTBOX_SKIP_FLAG]
    ) {
      return;
    }

    const snapshot =
      providedSnapshot ??
      this.getTrackedSnapshot(
        metadata,
        event.entity,
        this.getEventDatabaseEntity(event),
      );

    if (!snapshot) {
      return;
    }

    const payload = await this.buildPayload(
      metadata,
      metadata.tableName,
      queryRunner.manager,
      event.entity,
      this.getEventDatabaseEntity(event),
    );
    const outboxRepo = queryRunner.manager.getRepository(SyncOutboxEvent);

    queryRunnerData[OUTBOX_RECURSION_FLAG] = true;
    queryRunner.data = queryRunnerData;

    try {
      await outboxRepo.save(
        outboxRepo.create({
          resourceType: metadata.tableName,
          resourcePublicId: snapshot.publicId,
          resourceLocalId:
            snapshot.id == null ? null : String(this.serializeValue(snapshot.id)),
          operation,
          status: SyncOutboxStatus.PENDING,
          syncVersion: snapshot.syncVersion,
          syncOrigin: snapshot.syncOrigin,
          payload,
          attempts: 0,
          lastError: null,
          availableAt: new Date(),
          processedAt: null,
        }),
      );
    } finally {
      delete queryRunnerData[OUTBOX_RECURSION_FLAG];
      queryRunner.data = queryRunnerData;
    }
  }
}
