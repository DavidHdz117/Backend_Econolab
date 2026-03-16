import { IsBoolean } from 'class-validator';

export class UpdatePatientStatusDto {
  @IsBoolean({ message: 'El estatus del paciente debe ser booleano.' })
  isActive: boolean;
}
