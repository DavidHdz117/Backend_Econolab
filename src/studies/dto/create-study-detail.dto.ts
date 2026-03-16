import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { StudyDetailType } from '../entities/study-detail.entity';

export class CreateStudyDetailDto {
  @IsEnum(StudyDetailType, {
    message:
      'El tipo de dato es invalido. Valores permitidos: category, parameter.',
  })
  dataType: StudyDetailType;

  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @Length(1, 150, { message: 'El nombre del detalle es obligatorio.' })
  name: string;

  @Type(() => Number)
  @IsInt({ message: 'El orden debe ser un numero entero.' })
  @Min(1, { message: 'El orden minimo es 1.' })
  sortOrder: number;

  @IsOptional()
  @IsString({ message: 'La unidad debe ser una cadena de texto.' })
  unit?: string;

  @IsOptional()
  @IsString({
    message: 'Los valores de referencia deben ser una cadena de texto.',
  })
  referenceValue?: string;

  @Transform(({ value }) => {
    if (value === '' || value === undefined) return undefined;
    if (value === null) return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt({ message: 'El identificador del padre debe ser un numero entero.' })
  parentId?: number | null;
}
