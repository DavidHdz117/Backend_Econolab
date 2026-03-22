import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StudyStatus, StudyType } from '../entities/study.entity';

export class CreateStudyDto {
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @Length(1, 200, {
    message: 'El nombre del analisis es obligatorio y maximo de 200 caracteres.',
  })
  name: string;

  @IsOptional()
  @IsString({ message: 'La clave debe ser una cadena de texto.' })
  @Length(1, 50, {
    message: 'La clave debe tener entre 1 y 50 caracteres.',
  })
  code?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'La bandera de clave automatica es invalida.' })
  autoGenerateCode?: boolean;

  @IsOptional()
  @IsString({ message: 'La descripcion debe ser una cadena de texto.' })
  description?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'La duracion debe ser un numero de minutos.' })
  @Min(1, { message: 'La duracion minima es de 1 minuto.' })
  durationMinutes: number;

  @IsEnum(StudyType, {
    message:
      'El tipo de estudio es invalido. Valores permitidos: study, package, other.',
  })
  type: StudyType;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio normal debe ser numerico.' })
  @Min(0, { message: 'El precio normal no puede ser negativo.' })
  normalPrice: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio DIF debe ser numerico.' })
  @Min(0, { message: 'El precio DIF no puede ser negativo.' })
  difPrice: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio especial debe ser numerico.' })
  @Min(0, { message: 'El precio especial no puede ser negativo.' })
  specialPrice: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio hospital debe ser numerico.' })
  @Min(0, { message: 'El precio hospital no puede ser negativo.' })
  hospitalPrice: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El campo "otros" debe ser numerico.' })
  @Min(0, { message: 'El campo "otros" no puede ser negativo.' })
  otherPrice: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El porcentaje de descuento debe ser numerico.' })
  @Min(0, { message: 'El porcentaje de descuento no puede ser negativo.' })
  defaultDiscountPercent: number;

  @IsOptional()
  @IsString({ message: 'El metodo debe ser una cadena de texto.' })
  method?: string;

  @IsOptional()
  @IsString({ message: 'El indicador debe ser una cadena de texto.' })
  indicator?: string;

  @IsOptional()
  @IsArray({ message: 'Los estudios del paquete deben venir en un arreglo.' })
  @ArrayUnique({ message: 'No repitas estudios dentro del paquete.' })
  @Type(() => Number)
  @IsInt({
    each: true,
    message: 'Cada estudio del paquete debe ser un identificador numerico.',
  })
  packageStudyIds?: number[];

  @IsOptional()
  @IsEnum(StudyStatus, {
    message: 'El estatus es invalido. Valores permitidos: active, suspended.',
  })
  status?: StudyStatus;
}
