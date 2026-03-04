import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum BackupScope {
  TABLE = 'table',
  DATABASE = 'database',
}

export enum BackupFormat {
  SQL = 'sql',
  CSV = 'csv',
}

export class GenerateBackupDto {
  @IsEnum(BackupScope, {
    message: 'scope invalido. Valores permitidos: table, database.',
  })
  scope: BackupScope;

  @IsOptional()
  @IsString({ message: 'tableName debe ser una cadena de texto.' })
  tableName?: string;

  @IsOptional()
  @IsEnum(BackupFormat, {
    message: 'format invalido. Valores permitidos: sql, csv.',
  })
  format?: BackupFormat;
}
