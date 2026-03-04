import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { Role } from 'src/common/enums/roles.enum';
import { DB_ADMIN_POOL, DB_RECEPCIONISTA_POOL } from './database.constants';
import type { RoleCarrier, SupportedDbRole } from './database.types';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  constructor(
    @Inject(DB_ADMIN_POOL) private readonly adminPool: Pool,
    @Inject(DB_RECEPCIONISTA_POOL) private readonly recepcionistaPool: Pool,
    private readonly config: ConfigService,
  ) {}

  getPoolByRole(role: SupportedDbRole | RoleCarrier): Pool {
    return this.resolveRole(role) === Role.Admin ? this.adminPool : this.recepcionistaPool;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    role: SupportedDbRole | RoleCarrier,
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const pool = this.getPoolByRole(role);
    return pool.query<T>(text, values as unknown[]);
  }

  async queryInOperativeSchema<T extends QueryResultRow = QueryResultRow>(
    role: SupportedDbRole | RoleCarrier,
    text: string,
    values: readonly unknown[] = [],
    schema = this.config.get<string>('DATABASE_OPERATIVE_SCHEMA') ?? 'operativo',
  ): Promise<QueryResult<T>> {
    const safeSchema = this.assertSafeSchema(schema);
    const pool = this.getPoolByRole(role);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO ${safeSchema}, public`);
      const result = await client.query<T>(text, values as unknown[]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.adminPool.end(), this.recepcionistaPool.end()]);
  }

  private resolveRole(roleOrUser: SupportedDbRole | RoleCarrier): Role {
    const rawRole =
      typeof roleOrUser === 'string'
        ? roleOrUser
        : roleOrUser.role ?? roleOrUser.rol ?? Role.Recepcionista;

    return rawRole === Role.Admin || rawRole === 'admin' ? Role.Admin : Role.Recepcionista;
  }

  private assertSafeSchema(schema: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid schema name: ${schema}`);
    }
    return schema;
  }
}
