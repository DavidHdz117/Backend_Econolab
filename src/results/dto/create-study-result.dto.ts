import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StudyResultValueDto } from './study-result-value.dto';

export class CreateStudyResultDto {
  @Type(() => Number)
  @IsInt({
    message: 'El identificador del servicio debe ser un número entero.',
  })
  serviceOrderId: number;

  @Type(() => Number)
  @IsInt({
    message:
      'El identificador del estudio dentro del servicio debe ser un número entero.',
  })
  serviceOrderItemId: number;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de muestra no es válida.' })
  sampleAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de reporte no es válida.' })
  reportedAt?: string;

  @IsOptional()
  @IsString({ message: 'El método debe ser una cadena de texto.' })
  method?: string;

  @IsOptional()
  @IsString({ message: 'Las observaciones deben ser una cadena de texto.' })
  observations?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'El campo borrador debe ser verdadero o falso.' })
  isDraft?: boolean;

  @IsArray({ message: 'Los resultados deben venir en un arreglo.' })
  @ValidateNested({ each: true })
  @Type(() => StudyResultValueDto)
  values: StudyResultValueDto[];
}
