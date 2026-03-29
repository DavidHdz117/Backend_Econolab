import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  dropColumnIfExists,
} from '../migration-database.util';

const SYNC_DELETE_TABLES = [
  'patients',
  'doctors',
  'studies',
  'study_details',
  'service_orders',
  'service_order_items',
  'study_results',
  'study_result_values',
] as const;

export class AddDeletedAtToSyncEntities20260328000200
  implements MigrationInterface
{
  name = 'AddDeletedAtToSyncEntities20260328000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of SYNC_DELETE_TABLES) {
      await addColumnIfMissing(
        queryRunner,
        tableName,
        'deleted_at',
        '"deleted_at" timestamp NULL',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of SYNC_DELETE_TABLES) {
      await dropColumnIfExists(queryRunner, tableName, 'deleted_at');
    }
  }
}
