import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StudyDetailType } from '../entities/study-detail.entity';

export class CreateStudyDetailDto {
  @IsEnum(StudyDetailType, {
    message:
      'El tipo de dato es inválido. Valores permitidos: category, parameter.',
  })
  dataType: StudyDetailType;

  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @Length(1, 150, { message: 'El nombre del detalle es obligatorio.' })
  name: string;

  @Type(() => Number)
  @IsInt({ message: 'El orden debe ser un número entero.' })
  @Min(1, { message: 'El orden mínimo es 1.' })
  sortOrder: number;

  @IsOptional()
  @IsString({ message: 'La unidad debe ser una cadena de texto.' })
  unit?: string;

  @IsOptional()
  @IsString({
    message: 'Los valores de referencia deben ser una cadena de texto.',
  })
  referenceValue?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El identificador del padre debe ser un número entero.' })
  parentId?: number;
}
