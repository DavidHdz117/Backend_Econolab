import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreateDoctorDto {
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @Length(1, 100, {
    message: 'El nombre es obligatorio y máximo de 100 caracteres.',
  })
  firstName: string;

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

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'El teléfono debe ser una cadena de texto.' })
  phone?: string;

  @IsOptional()
  @IsString({ message: 'La especialidad debe ser una cadena de texto.' })
  @Length(1, 150, {
    message: 'La especialidad debe tener máximo 150 caracteres.',
  })
  specialty?: string;

  @IsOptional()
  @IsString({ message: 'La cédula profesional debe ser una cadena de texto.' })
  @Length(1, 50, {
    message: 'La cédula profesional debe tener máximo 50 caracteres.',
  })
  licenseNumber?: string;

  @IsOptional()
  @IsString({ message: 'Las notas deben ser una cadena de texto.' })
  notes?: string;
}
