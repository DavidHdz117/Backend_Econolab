import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'El nombre no puede superar 100 caracteres' })
  @Matches(/^[^<>]*$/, {
    message: 'El nombre contiene caracteres no permitidos',
  })
  nombre?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo no es valido' })
  @MaxLength(150, { message: 'El correo no puede superar 150 caracteres' })
  email?: string;
}
