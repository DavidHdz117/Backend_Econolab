import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StudyResultValueDto {
  @IsOptional()
  @IsUUID('4', {
    message: 'El publicId del valor debe ser un UUID valido.',
  })
  publicId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El identificador del detalle debe ser un número entero.' })
  studyDetailId?: number;

  @IsString({ message: 'La etiqueta debe ser una cadena de texto.' })
  label: string;

  @IsOptional()
  @IsString({ message: 'La unidad debe ser una cadena de texto.' })
  unit?: string;

  @IsOptional()
  @IsString({
    message: 'Los valores de referencia deben ser una cadena de texto.',
  })
  referenceValue?: string;

  @IsOptional()
  @IsString({ message: 'El resultado debe ser una cadena de texto.' })
  value?: string;

  @Type(() => Number)
  @IsInt({ message: 'El orden debe ser un número entero.' })
  @Min(1, { message: 'El orden mínimo es 1.' })
  sortOrder: number;

  @Type(() => Boolean)
  @IsBoolean({ message: 'El campo visible debe ser verdadero o falso.' })
  visible: boolean;
}
