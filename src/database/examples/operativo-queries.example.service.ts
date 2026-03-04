import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import type { RoleCarrier } from '../database.types';

interface OperativePatientRow {
  id: string;
  nombre: string;
  email: string | null;
}

@Injectable()
export class OperativoQueriesExampleService {
  constructor(private readonly db: DatabaseService) {}

  async listPatients(user: RoleCarrier): Promise<OperativePatientRow[]> {
    const { rows } = await this.db.queryInOperativeSchema<OperativePatientRow>(
      user,
      `
      SELECT id, nombre, email
      FROM pacientes
      ORDER BY created_at DESC
      LIMIT 50
      `,
    );

    return rows;
  }

  async updatePatientPhone(user: RoleCarrier, patientId: string, telefono: string): Promise<void> {
    await this.db.queryInOperativeSchema(
      user,
      `
      UPDATE pacientes
      SET telefono = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [telefono, patientId],
    );
  }
}
