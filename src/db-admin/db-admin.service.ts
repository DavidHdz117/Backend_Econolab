import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { QueryResultRow } from 'pg';
import { Role } from 'src/common/enums/roles.enum';
import { DatabaseService } from 'src/database/database.service';
import { DataSource } from 'typeorm';
import {
  BackupFormat,
  BackupScope,
  GenerateBackupDto,
} from './dto/generate-backup.dto';

type DbIdentityRow = QueryResultRow & {
  current_user: string;
  current_schema: string;
  now: string;
};

type TableRef = {
  schema: string;
  name: string;
  qualifiedName: string;
};

@Injectable()
export class DbAdminService {
  constructor(
    private readonly db: DatabaseService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async generateBackup(payload: GenerateBackupDto) {
    const format = payload.format ?? BackupFormat.SQL;
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');

    if (payload.scope === BackupScope.TABLE) {
      if (!payload.tableName) {
        throw new BadRequestException('tableName es requerido cuando scope = table');
      }

      const tableRef = this.parseTableReference(payload.tableName);
      const safeFileBase = `${tableRef.schema}_${tableRef.name}`;
      if (format === BackupFormat.CSV) {
        const csv = await this.exportTableAsCsv(tableRef.qualifiedName);
        return {
          fileName: `${safeFileBase}_${stamp}.csv`,
          mimeType: 'text/csv; charset=utf-8',
          content: csv,
        };
      }

      const sql = await this.exportTableAsSql(tableRef.qualifiedName);
      return {
        fileName: `${safeFileBase}_${stamp}.sql`,
        mimeType: 'application/sql; charset=utf-8',
        content: sql,
      };
    }

    const sql = await this.exportDatabaseAsSql();
    return {
      fileName: `db_operativo_${stamp}.sql`,
      mimeType: 'application/sql; charset=utf-8',
      content: sql,
    };
  }

  async topics() {
    const [backupRestore, automation, exportImport, security, performance] =
      await Promise.all([
        this.backupRestore(),
        this.automation(),
        this.exportImport(),
        this.security(),
        this.performance(),
      ]);

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      module: 'Administracion de Base de Datos',
      topics: [
        backupRestore,
        automation,
        exportImport,
        security,
        performance,
      ],
    };
  }

  async health() {
    const admin = await this.getIdentity(Role.Admin);
    const recepcionista = await this.getIdentity(Role.Recepcionista);

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      connections: {
        admin,
        recepcionista,
      },
    };
  }

  async overview() {
    const [patients, doctors, studies, services] = await Promise.all([
      this.countFromOperativeTable(Role.Admin, 'patients'),
      this.countFromOperativeTable(Role.Admin, 'doctors'),
      this.countFromOperativeTable(Role.Admin, 'studies'),
      this.countFromOperativeTable(Role.Admin, 'service_orders'),
    ]);

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      schema: 'operativo',
      totals: {
        patients,
        doctors,
        studies,
        services,
      },
    };
  }

  async tables() {
    const rows = await this.dataSource.query(
      `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('operativo', 'public')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema ASC, table_name ASC
      `,
    );

    const tables = rows.map((row) => ({
      schema: row.table_schema,
      name: row.table_name,
      qualifiedName: `${row.table_schema}.${row.table_name}`,
    }));

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      schemas: ['operativo', 'public'],
      tables,
    };
  }

  async backupRestore() {
    return {
      id: 'backup_restore',
      title: 'Copias de seguridad y restauracion',
      status: 'partial',
      summary:
        'Se documentan estrategias y prevalidaciones de conexion. La ejecucion automatizada de backup/restore aun no se expone por API.',
      implemented: [
        'Diagnostico de conexion admin/recepcionista',
        'Inventario de tablas operativas para planeacion de respaldos',
      ],
      pending: [
        'Disparo de backup desde API con control de permisos',
        'Flujo de restauracion por archivo validado',
      ],
      recommendation:
        'Usar pg_dump/pg_restore via job externo y almacenar bitacora de ejecuciones.',
    };
  }

  async automation() {
    const { rows } = await this.db.query<{
      installed: boolean;
      version: string | null;
    }>(
      Role.Admin,
      `
      SELECT
        installed_version IS NOT NULL AS installed,
        installed_version::text AS version
      FROM pg_available_extensions
      WHERE name = 'pg_cron'
      `,
    );

    const ext = rows[0] ?? { installed: false, version: null };
    return {
      id: 'automation',
      title: 'Automatizacion de tareas',
      status: ext.installed ? 'partial' : 'planned',
      summary:
        'Se valida si existe soporte de planificador en la base. La gestion de jobs aun no esta habilitada en UI/API.',
      implemented: [
        'Deteccion de extension pg_cron',
        'Base para monitoreo de tareas programadas',
      ],
      pending: [
        'Alta/baja/edicion de jobs programados',
        'Politicas de reintento y alertamiento',
      ],
      data: {
        pgCronInstalled: ext.installed,
        pgCronVersion: ext.version,
      },
    };
  }

  async exportImport() {
    const tables = await this.tables();
    return {
      id: 'export_import',
      title: 'Exportacion e importacion de datos',
      status: 'partial',
      summary:
        'Se ofrece catalogo de tablas operativas para preparar export/import. Falta flujo transaccional completo desde la app.',
      implemented: [
        'Listado de tablas disponibles para intercambio',
        'Definicion de formatos objetivo CSV/JSON para operaciones',
      ],
      pending: [
        'Importador con validaciones por lote',
        'Exportador incremental por fechas',
      ],
      data: {
        availableFormats: ['csv', 'json'],
        operativeTables: tables.tables.map((table) => table.qualifiedName),
      },
    };
  }

  async security() {
    const [adminIdentity, recepIdentity, privilegeSummary] = await Promise.all([
      this.getIdentity(Role.Admin),
      this.getIdentity(Role.Recepcionista),
      this.operativePrivileges(),
    ]);

    return {
      id: 'security',
      title: 'Administracion de seguridad en BD relacional',
      status: 'implemented',
      summary:
        'Se valida separacion de usuarios de conexion y privilegios del esquema operativo.',
      implemented: [
        'Conexion separada por rol de aplicacion',
        'Consulta de privilegios activos en esquema operativo',
      ],
      pending: [
        'Auditoria de DDL y DML sensible',
        'Rotacion automatizada de credenciales',
      ],
      data: {
        identities: {
          admin: adminIdentity,
          recepcionista: recepIdentity,
        },
        privilegeSummary,
      },
    };
  }

  async performance() {
    const [dbStats, activity] = await Promise.all([
      this.db.query<{
        commits: string | number;
        rollbacks: string | number;
        deadlocks: string | number;
        temp_files: string | number;
        blks_read: string | number;
        blks_hit: string | number;
      }>(
        Role.Admin,
        `
        SELECT
          xact_commit AS commits,
          xact_rollback AS rollbacks,
          deadlocks,
          temp_files,
          blks_read,
          blks_hit
        FROM pg_stat_database
        WHERE datname = current_database()
        `,
      ),
      this.db.query<{
        active_connections: string | number;
      }>(
        Role.Admin,
        `
        SELECT COUNT(*)::int AS active_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
        `,
      ),
    ]);

    const stats = dbStats.rows[0];
    const activeConnections = Number(activity.rows[0]?.active_connections ?? 0);
    const blocksRead = Number(stats?.blks_read ?? 0);
    const blocksHit = Number(stats?.blks_hit ?? 0);
    const cacheHitRatio =
      blocksHit + blocksRead === 0 ? 0 : Number((blocksHit / (blocksHit + blocksRead)).toFixed(4));

    return {
      id: 'performance',
      title: 'Monitoreo del rendimiento del sistema gestor relacional',
      status: 'implemented',
      summary:
        'Se exponen indicadores clave de actividad y eficiencia de cache para diagnostico operativo.',
      implemented: [
        'Lectura de metricas desde pg_stat_database',
        'Conteo de conexiones activas desde pg_stat_activity',
      ],
      pending: [
        'Serie historica de metricas',
        'Alertas por umbrales de rendimiento',
      ],
      data: {
        activeConnections,
        commits: Number(stats?.commits ?? 0),
        rollbacks: Number(stats?.rollbacks ?? 0),
        deadlocks: Number(stats?.deadlocks ?? 0),
        tempFiles: Number(stats?.temp_files ?? 0),
        cacheHitRatio,
      },
    };
  }

  private async getIdentity(role: Role) {
    const { rows } = await this.db.query<DbIdentityRow>(
      role,
      `
      SELECT
        CURRENT_USER AS current_user,
        CURRENT_SCHEMA AS current_schema,
        NOW()::text AS now
      `,
    );

    const row = rows[0];
    return {
      role,
      currentUser: row.current_user,
      currentSchema: row.current_schema,
      dbTime: row.now,
    };
  }

  private async countFromOperativeTable(role: Role, tableName: string): Promise<number> {
    const safeTable = this.assertIdentifier(tableName);
    const { rows } = await this.db.queryInOperativeSchema<{ total: string | number }>(
      role,
      `SELECT COUNT(*)::int AS total FROM ${safeTable}`,
    );

    return Number(rows[0]?.total ?? 0);
  }

  private async operativePrivileges() {
    const { rows } = await this.db.query<{
      grantee: string;
      table_name: string;
      privileges: string | null;
    }>(
      Role.Admin,
      `
      SELECT
        grantee,
        table_name,
        string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
      FROM information_schema.table_privileges
      WHERE table_schema = 'operativo'
        AND grantee IN ('db_admin', 'db_recepcionista')
      GROUP BY grantee, table_name
      ORDER BY grantee, table_name
      `,
    );

    return rows;
  }

  private async exportTableAsCsv(tableName: string): Promise<string> {
    const tableRef = this.parseTableReference(tableName);
    const rows = await this.getTableRows(tableRef);
    const columns = await this.getTableColumns(tableRef);

    const header = columns.map((col) => this.escapeCsv(col)).join(',');
    const body = rows
      .map((row) =>
        columns
          .map((col) => this.escapeCsv(this.normalizeForCsv(row[col])))
          .join(','),
      )
      .join('\n');

    return `${header}\n${body}`.trimEnd();
  }

  private async exportTableAsSql(tableName: string): Promise<string> {
    const tableRef = this.parseTableReference(tableName);
    const rows = await this.getTableRows(tableRef);
    const columns = await this.getTableColumns(tableRef);
    const qualifiedTable = `${tableRef.schema}.${tableRef.name}`;

    const lines: string[] = [
      `-- Backup table: ${qualifiedTable}`,
      `-- Generated at: ${new Date().toISOString()}`,
      '',
      `SET search_path TO operativo, public;`,
      '',
    ];

    if (rows.length === 0) {
      lines.push(`-- Table ${qualifiedTable} has no rows.`);
      return lines.join('\n');
    }

    const columnList = columns.map((col) => `"${col}"`).join(', ');
    for (const row of rows) {
      const valueList = columns
        .map((col) => this.toSqlLiteral(row[col]))
        .join(', ');
      lines.push(`INSERT INTO ${qualifiedTable} (${columnList}) VALUES (${valueList});`);
    }

    return lines.join('\n');
  }

  private async exportDatabaseAsSql(): Promise<string> {
    const tableInfo = await this.tables();
    const lines: string[] = [
      `-- Backup schema operativo`,
      `-- Generated at: ${new Date().toISOString()}`,
      '',
      `SET search_path TO operativo, public;`,
      '',
    ];

    for (const table of tableInfo.tables) {
      const block = await this.exportTableAsSql(table.qualifiedName);
      lines.push(block);
      lines.push('');
    }

    return lines.join('\n');
  }

  private async getTableRows(table: TableRef): Promise<Record<string, unknown>[]> {
    const safeSchema = this.assertIdentifier(table.schema);
    const safeTable = this.assertIdentifier(table.name);
    return this.dataSource.query(`SELECT * FROM ${safeSchema}.${safeTable}`);
  }

  private async getTableColumns(table: TableRef): Promise<string[]> {
    const rows = await this.dataSource.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position ASC
      `,
      [table.schema, table.name],
    );

    return rows.map((row: { column_name: string }) => row.column_name);
  }

  private escapeCsv(value: unknown): string {
    const raw = value == null ? '' : String(value);
    if (/[,"\n\r]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  }

  private normalizeForCsv(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private toSqlLiteral(value: unknown): string {
    if (value == null) return 'NULL';
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
    if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private parseTableReference(raw: string): TableRef {
    const trimmed = raw.trim();
    const [first, second] = trimmed.split('.');

    if (second) {
      const schema = this.assertIdentifier(first);
      const name = this.assertIdentifier(second);
      return { schema, name, qualifiedName: `${schema}.${name}` };
    }

    const name = this.assertIdentifier(first);
    return { schema: 'operativo', name, qualifiedName: `operativo.${name}` };
  }

  private assertIdentifier(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return name;
  }
}
