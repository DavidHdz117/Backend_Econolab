import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

type PassportInfo = Error | { name?: string } | null | undefined;

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: PassportInfo,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    void context;
    void status;
    if (err || !user) {
      const infoName = info instanceof Error ? info.name : info?.name;
      if (infoName === 'TokenExpiredError') {
        throw new UnauthorizedException(
          'El token ha expirado, inicie sesion nuevamente',
        );
      }

      throw new UnauthorizedException('Token no valido o inexistente');
    }

    return user;
  }
}
