import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PatientGender } from '../entities/patient.entity';

export class CreatePatientDto {
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @Length(1, 100, {
    message: 'El nombre es obligatorio y máximo de 100 caracteres.',
  })
  firstName: string;

  @IsOptional()
  @IsString({ message: 'El apellido paterno debe ser una cadena de texto.' })
  @Length(1, 100, {
    message: 'El apellido paterno es obligatorio y máximo de 100 caracteres.',
  })
  lastName: string;

  @IsOptional()
  @IsString({ message: 'El apellido materno debe ser una cadena de texto.' })
  @Length(1, 100, {
    message: 'El apellido materno debe tener máximo 100 caracteres.',
  })
  middleName?: string;

  @IsEnum(PatientGender, {
    message: 'El sexo es inválido. Valores permitidos: male, female, other.',
  })
  gender: PatientGender;

  @IsDateString(
    {},
    {
      message: 'La fecha de nacimiento debe tener formato válido (YYYY-MM-DD).',
    },
  )
  birthDate: string;

  @IsOptional()
  @IsString({ message: 'El teléfono debe ser una cadena de texto.' })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'La dirección debe ser una cadena de texto.' })
  addressLine?: string;

  @IsOptional()
  @IsString({
    message: 'El campo "entre calles" debe ser una cadena de texto.',
  })
  addressBetween?: string;

  @IsOptional()
  @IsString({ message: 'La ciudad debe ser una cadena de texto.' })
  addressCity?: string;

  @IsOptional()
  @IsString({ message: 'El estado debe ser una cadena de texto.' })
  addressState?: string;

  @IsOptional()
  @IsString({ message: 'El código postal debe ser una cadena de texto.' })
  addressZip?: string;

  @IsOptional()
  @IsString({ message: 'El tipo de documento debe ser una cadena de texto.' })
  documentType?: string;

  @IsOptional()
  @IsString({ message: 'El número de documento debe ser una cadena de texto.' })
  documentNumber?: string;
}
