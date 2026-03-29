import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  getMigrationDatabaseType,
} from '../migration-database.util';

export class AddSyncOutboxLeasing20260329000200
  implements MigrationInterface
{
  name = 'AddSyncOutboxLeasing20260329000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('sync_outbox_events'))) {
      return;
    }

    const databaseType = getMigrationDatabaseType(queryRunner);
    const timestampType = databaseType === 'sqlite' ? 'datetime' : 'timestamp';

    await addColumnIfMissing(
      queryRunner,
      'sync_outbox_events',
      'lease_token',
      `"lease_token" varchar(64)`,
    );
    await addColumnIfMissing(
      queryRunner,
      'sync_outbox_events',
      'leased_at',
      `"leased_at" ${timestampType}`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_sync_outbox_lease_token"
      ON "sync_outbox_events" ("lease_token")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('sync_outbox_events'))) {
      return;
    }

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sync_outbox_lease_token"`);

    if (await queryRunner.hasColumn('sync_outbox_events', 'leased_at')) {
      await queryRunner.dropColumn('sync_outbox_events', 'leased_at');
    }

    if (await queryRunner.hasColumn('sync_outbox_events', 'lease_token')) {
      await queryRunner.dropColumn('sync_outbox_events', 'lease_token');
    }
  }
}
