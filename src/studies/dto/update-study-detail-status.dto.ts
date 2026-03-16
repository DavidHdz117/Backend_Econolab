import { IsBoolean } from 'class-validator';

export class UpdateStudyDetailStatusDto {
  @IsBoolean({ message: 'El estatus del detalle debe ser booleano.' })
  isActive: boolean;
}
