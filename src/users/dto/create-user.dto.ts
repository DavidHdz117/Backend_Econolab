import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'El nombre no puede superar 100 caracteres' })
  @Matches(/^[^<>]*$/, {
    message: 'El nombre contiene caracteres no permitidos',
  })
  nombre: string;

  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(150, { message: 'El correo no puede superar 150 caracteres' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(128, { message: 'La contraseña no puede superar 128 caracteres' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).+$/, {
    message:
      'La contraseña debe incluir mayúsculas, minúsculas, números y un carácter especial',
  })
  password: string;
}
