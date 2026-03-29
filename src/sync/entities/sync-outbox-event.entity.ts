import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  getPortableCreateDateColumnOptions,
  getPortableEnumColumnOptions,
  getPortableJsonColumnOptions,
  getPortableTimestampColumnOptions,
  getPortableUpdateDateColumnOptions,
} from '../../database/portable-column-options';

export enum SyncOutboxOperation {
  UPSERT = 'upsert',
  DELETE = 'delete',
}

export enum SyncOutboxStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SYNCED = 'synced',
  FAILED = 'failed',
}

@Entity({ name: 'sync_outbox_events' })
@Index('idx_sync_outbox_status_available', ['status', 'availableAt'])
@Index('idx_sync_outbox_resource_pending', [
  'resourceType',
  'resourcePublicId',
  'status',
])
@Index('idx_sync_outbox_lease_token', ['leaseToken'])
export class SyncOutboxEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'resource_type', type: 'varchar', length: 120 })
  resourceType!: string;

  @Column({ name: 'resource_public_id', type: 'varchar', length: 36 })
  resourcePublicId!: string;

  @Column({
    name: 'resource_local_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  resourceLocalId!: string | null;

  @Column(getPortableEnumColumnOptions(SyncOutboxOperation))
  operation!: SyncOutboxOperation;

  @Column(
    getPortableEnumColumnOptions(SyncOutboxStatus, SyncOutboxStatus.PENDING),
  )
  status!: SyncOutboxStatus;

  @Column({ name: 'sync_version', type: 'int', default: 1 })
  syncVersion!: number;

  @Column({ name: 'sync_origin', type: 'varchar', length: 32, nullable: true })
  syncOrigin!: string | null;

  @Column(getPortableJsonColumnOptions('{}'))
  payload!: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column(
    getPortableTimestampColumnOptions({ name: 'available_at' }, 'timestamp'),
  )
  availableAt!: Date;

  @Column(
    getPortableTimestampColumnOptions(
      { name: 'processed_at', nullable: true },
      'timestamp',
    ),
  )
  processedAt!: Date | null;

  @Column({ name: 'lease_token', type: 'varchar', length: 64, nullable: true })
  leaseToken!: string | null;

  @Column(
    getPortableTimestampColumnOptions(
      { name: 'leased_at', nullable: true },
      'timestamp',
    ),
  )
  leasedAt!: Date | null;

  @CreateDateColumn(
    getPortableCreateDateColumnOptions({ name: 'created_at' }, 'timestamp'),
  )
  createdAt!: Date;

  @UpdateDateColumn(
    getPortableUpdateDateColumnOptions({ name: 'updated_at' }, 'timestamp'),
  )
  updatedAt!: Date;
}
