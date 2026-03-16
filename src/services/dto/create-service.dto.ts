import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceStatus } from '../entities/service-order.entity';
import { CreateServiceItemDto } from './service-item.dto';

export class CreateServiceDto {
  @IsString({ message: 'El folio debe ser una cadena de texto.' })
  @IsNotEmpty({ message: 'El folio es obligatorio.' })
  folio: string;

  @Type(() => Number)
  @IsInt({
    message: 'El identificador del paciente debe ser un número entero.',
  })
  patientId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El identificador del médico debe ser un número entero.' })
  doctorId?: number;

  @IsOptional()
  @IsString({ message: 'La sucursal debe ser una cadena de texto.' })
  branchName?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'La fecha/hora de toma de muestra no es válida.' },
  )
  sampleAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha/hora de entrega no es válida.' })
  deliveryAt?: string;

  @IsOptional()
  @IsEnum(ServiceStatus, {
    message:
      'El estatus es inválido. Valores permitidos: pending, in_progress, delayed, completed, cancelled.',
  })
  status?: ServiceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El porcentaje de cortesía debe ser numérico.' })
  @Min(0, { message: 'La cortesía no puede ser negativa.' })
  @Max(100, { message: 'La cortesía no puede ser mayor a 100.' })
  courtesyPercent?: number;

  @IsOptional()
  @IsString({ message: 'Las notas deben ser una cadena de texto.' })
  notes?: string;

  @IsArray({ message: 'Los estudios deben venir en un arreglo.' })
  @ValidateNested({ each: true })
  @Type(() => CreateServiceItemDto)
  items: CreateServiceItemDto[];
}
