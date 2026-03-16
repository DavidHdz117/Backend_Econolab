import { IsBoolean } from 'class-validator';

export class UpdateDoctorStatusDto {
  @IsBoolean({ message: 'El estatus del medico debe ser verdadero o falso.' })
  isActive: boolean;
}
