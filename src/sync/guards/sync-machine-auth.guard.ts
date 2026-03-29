import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import {
  type SyncRuntimeConfig,
} from '../../config/sync.config';
import {
  type AuthenticatedUser,
  type RequestWithUser,
} from '../../common/types/auth-request.type';
import { Role } from '../../common/enums/roles.enum';

type PassportInfo = Error | { name?: string } | null | undefined;

type SyncMachineUser = AuthenticatedUser & {
  authType: 'sync-machine';
};

@Injectable()
export class SyncMachineAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  private get runtimeConfig(): SyncRuntimeConfig {
    return this.configService.getOrThrow<SyncRuntimeConfig>('sync');
  }

  private extractSyncToken(request: RequestWithUser<Partial<SyncMachineUser>>) {
    const headerName = this.runtimeConfig.machineHeaderName;
    const directHeaderValue = request.header(headerName)?.trim();

    if (directHeaderValue) {
      return directHeaderValue;
    }

    const authorization = request.header('authorization')?.trim();
    if (!authorization) {
      return null;
    }

    const match = authorization.match(/^sync\s+(.+)$/i);
    return match?.[1]?.trim() || null;
  }

  private safeTokenEquals(provided: string, expected: string) {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }

  private createMachineUser(): SyncMachineUser {
    return {
      id: 'sync-machine',
      email: 'sync-machine@econolab.local',
      rol: Role.Admin,
      jti: 'sync-machine',
      authType: 'sync-machine',
    };
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<
      RequestWithUser<Partial<SyncMachineUser>>
    >();
    const syncToken = this.extractSyncToken(request);

    if (syncToken) {
      if (!this.runtimeConfig.machineAuthEnabled) {
        throw new UnauthorizedException(
          'La autenticacion de sync por token esta deshabilitada.',
        );
      }

      const expectedToken = this.runtimeConfig.machineToken?.trim();
      if (!expectedToken) {
        throw new UnauthorizedException(
          'La autenticacion de sync por token no esta configurada correctamente.',
        );
      }

      if (!this.safeTokenEquals(syncToken, expectedToken)) {
        throw new UnauthorizedException('Token de sync no valido');
      }

      request.user = this.createMachineUser();
      return true;
    }

    const authenticated = (await super.canActivate(context)) as boolean;
    const authenticatedUser = request.user as AuthenticatedUser | undefined;

    if (!authenticatedUser?.rol) {
      throw new UnauthorizedException('Token no valido o inexistente');
    }

    if (authenticatedUser.rol !== Role.Admin) {
      throw new ForbiddenException(
        'Solo un administrador o un cliente de sync autorizado puede operar sync.',
      );
    }

    return authenticated;
  }

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
