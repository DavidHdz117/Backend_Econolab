// auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppJwtPayload } from 'src/common/utils/jwt.util';
import { UserSession } from '../entities/user-session.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: ConfigService,
    @InjectRepository(UserSession)
    private readonly sessionsRepo: Repository<UserSession>,
  ) {
    const secret = cfg.get<string>('JWT_SECRET');
    if (!secret) throw new Error('Falta JWT_SECRET en variables de entorno');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
      ignoreExpiration: false, // respeta exp del JWT
    });
  }

  async validate(payload: AppJwtPayload) {
    // 1) jti obligatorio
    if (!payload.jti) {
      throw new UnauthorizedException('Token sin id de sesión');
    }

    // 2) buscar sesión
    const session = await this.sessionsRepo.findOne({
      where: { id: payload.jti },
      relations: ['user'],
    });

    if (!session) {
      throw new UnauthorizedException('Sesión no encontrada');
    }

    // 3) revocada
    if (session.revoked) {
      throw new UnauthorizedException('Sesión revocada');
    }

    const { user } = session;

    // Lo que se inyecta en req.user
    return {
      id: user.id,
      email: user.email,
      rol: user.rol,
      jti: session.id,
    };
  }
}
