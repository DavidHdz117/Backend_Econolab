import { randomUUID } from 'node:crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

const SYNC_PUBLIC_ID_TABLES = [
  'user',
  'patients',
  'doctors',
  'studies',
  'study_details',
  'service_orders',
  'service_order_items',
  'study_results',
  'study_result_values',
] as const;

export class BackfillMissingSyncPublicIds20260331000100
  implements MigrationInterface
{
  name = 'BackfillMissingSyncPublicIds20260331000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of SYNC_PUBLIC_ID_TABLES) {
      if (!(await queryRunner.hasColumn(tableName, 'public_id'))) {
        continue;
      }

      const rows = (await queryRunner.query(
        `SELECT "id" FROM "${tableName}" WHERE "public_id" IS NULL`,
      )) as Array<{ id: number | string }>;

      for (const row of rows) {
        await queryRunner.query(
          `UPDATE "${tableName}" SET "public_id" = '${randomUUID()}' WHERE "id" = ${Number(row.id)}`,
        );
      }
    }
  }

  public async down(): Promise<void> {
    // This is a data-repair migration. It intentionally does not null-out generated public IDs.
  }
}
