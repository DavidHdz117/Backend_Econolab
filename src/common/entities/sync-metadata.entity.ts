import { randomUUID } from 'node:crypto';
import { BeforeInsert, BeforeUpdate, Column } from 'typeorm';
import { getPortableTimestampColumnOptions } from '../../database/portable-column-options';
import { getSyncRuntimeConfig } from '../../config/sync.config';
import { shouldPreserveRemoteSyncMetadata } from '../../sync/sync-entity.util';

export abstract class SyncMetadataEntity {
  private getDefaultSyncOrigin() {
    return getSyncRuntimeConfig().defaultOrigin;
  }

  @Column({
    name: 'public_id',
    type: 'varchar',
    length: 36,
    unique: true,
    nullable: true,
  })
  publicId!: string | null;

  @Column({ name: 'sync_version', type: 'int', default: 1 })
  syncVersion!: number;

  @Column({ name: 'last_synced_version', type: 'int', default: 0 })
  lastSyncedVersion!: number;

  @Column({ name: 'sync_origin', type: 'varchar', length: 32, default: 'server' })
  syncOrigin!: string;

  @Column(
    getPortableTimestampColumnOptions(
      { name: 'last_synced_at', nullable: true },
      'timestamp',
    ),
  )
  lastSyncedAt!: Date | null;

  @Column(
    getPortableTimestampColumnOptions(
      { name: 'deleted_at', nullable: true },
      'timestamp',
    ),
  )
  deletedAt!: Date | null;

  @BeforeInsert()
  ensureSyncMetadataOnInsert() {
    const preserveRemoteMetadata = shouldPreserveRemoteSyncMetadata(this);

    if (!this.publicId) {
      this.publicId = randomUUID();
    }

    if (!this.syncVersion || this.syncVersion < 1) {
      this.syncVersion = 1;
    }

    if (this.lastSyncedVersion == null || this.lastSyncedVersion < 0) {
      this.lastSyncedVersion = 0;
    }

    if (!this.syncOrigin) {
      this.syncOrigin = this.getDefaultSyncOrigin();
    }

    if (preserveRemoteMetadata) {
      return;
    }
  }

  @BeforeUpdate()
  ensureSyncMetadataOnUpdate() {
    const preserveRemoteMetadata = shouldPreserveRemoteSyncMetadata(this);

    if (!this.publicId) {
      this.publicId = randomUUID();
    }

    if (!this.syncOrigin) {
      this.syncOrigin = this.getDefaultSyncOrigin();
    }

    this.lastSyncedVersion = Math.max(0, this.lastSyncedVersion ?? 0);

    if (preserveRemoteMetadata) {
      this.syncVersion = Math.max(1, this.syncVersion ?? 1);
      return;
    }

    this.syncVersion = Math.max(1, this.syncVersion ?? 1) + 1;
  }
}
