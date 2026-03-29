import { QueryRunner } from 'typeorm';
import type { SupportedDatabaseType } from '../config/database.config';

export function getMigrationDatabaseType(
  queryRunner: QueryRunner,
): SupportedDatabaseType {
  return queryRunner.connection.options.type === 'sqlite'
    ? 'sqlite'
    : 'postgres';
}

export function getSqlBooleanLiteral(
  databaseType: SupportedDatabaseType,
  value: boolean,
) {
  if (databaseType === 'sqlite') {
    return value ? '1' : '0';
  }

  return value ? 'true' : 'false';
}

export async function addColumnIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
  columnDefinitionSql: string,
) {
  if (await queryRunner.hasColumn(tableName, columnName)) {
    return;
  }

  await queryRunner.query(`
    ALTER TABLE "${tableName}"
    ADD COLUMN ${columnDefinitionSql}
  `);
}

export async function dropColumnIfExists(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
) {
  if (!(await queryRunner.hasColumn(tableName, columnName))) {
    return;
  }

  await queryRunner.dropColumn(tableName, columnName);
}
