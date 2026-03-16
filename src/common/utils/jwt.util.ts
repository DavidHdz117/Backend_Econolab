import * as jwt from 'jsonwebtoken';
import { Secret } from 'jsonwebtoken';
import { Role } from '../enums/roles.enum';

/** Payload que graba dentro del JWT */
export interface AppJwtPayload extends jwt.JwtPayload {
  sub: string; // id del usuario
  email: string;
  nombre: string;
  rol: Role;
  jti?: string; // id de la sesión
  iat?: number;
  exp?: number;
}

export function generateJWT(payload: AppJwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Falta la variable de entorno JWT_SECRET');

  return jwt.sign(payload, secret as Secret, {
    expiresIn: '30d',
    algorithm: 'HS256',
  });
}
