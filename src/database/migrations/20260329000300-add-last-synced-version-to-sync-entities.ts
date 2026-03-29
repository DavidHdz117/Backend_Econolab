import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  dropColumnIfExists,
} from '../migration-database.util';

const SYNC_METADATA_TABLES = [
  'patients',
  'doctors',
  'studies',
  'study_details',
  'service_orders',
  'service_order_items',
  'study_results',
  'study_result_values',
] as const;

export class AddLastSyncedVersionToSyncEntities20260329000300
  implements MigrationInterface
{
  name = 'AddLastSyncedVersionToSyncEntities20260329000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of SYNC_METADATA_TABLES) {
      await addColumnIfMissing(
        queryRunner,
        tableName,
        'last_synced_version',
        '"last_synced_version" integer NOT NULL DEFAULT 0',
      );

      await queryRunner.query(`
        UPDATE "${tableName}"
        SET "last_synced_version" = CASE
          WHEN "last_synced_at" IS NULL THEN 0
          ELSE COALESCE("sync_version", 1)
        END
        WHERE "last_synced_version" IS NULL
           OR "last_synced_version" < 0
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of SYNC_METADATA_TABLES) {
      await dropColumnIfExists(queryRunner, tableName, 'last_synced_version');
    }
  }
}
