import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { checkPassword } from '../common/utils/crypto.util';
import { Role } from '../common/enums/roles.enum';
import { generateJWT, type AppJwtPayload } from '../common/utils/jwt.util';
import type { AppRuntimeConfig } from '../config/app.config';
import { SyncRunnerService } from '../sync/sync-runner.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthEventsService } from './auth-events.service';
import { LoginDto } from './dto/login.dto';
import { UserSession } from './entities/user-session.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly authEvents: AuthEventsService,
    private readonly configService: ConfigService,
    private readonly syncRunner: SyncRunnerService,
    @InjectRepository(UserSession)
    private readonly sessionsRepo: Repository<UserSession>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  private get appRuntimeConfig(): AppRuntimeConfig {
    return this.configService.getOrThrow<AppRuntimeConfig>('app');
  }

  private async tryHydrateUsersForDesktopLogin(email: string) {
    const runtimeMode = this.appRuntimeConfig.runtimeMode;
    if (runtimeMode === 'web-online') {
      return null;
    }

    if (!this.syncRunner.getStatus().remoteBaseUrlConfigured) {
      return null;
    }

    try {
      await this.syncRunner.bootstrapFromRemote({
        resourceTypes: ['users'],
        includeDeleted: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `No se pudieron hidratar usuarios remotos para login desktop: ${message}`,
      );
      return {
        user: null,
        hydrationFailed: true,
      };
    }

    return {
      user: await this.users.findByEmail(email),
      hydrationFailed: false,
    };
  }

  private async ensureDesktopDataReadyForLogin() {
    const runtimeMode = this.appRuntimeConfig.runtimeMode;
    if (runtimeMode === 'web-online') {
      return;
    }

    if (!this.syncRunner.getStatus().remoteBaseUrlConfigured) {
      return;
    }

    try {
      await this.syncRunner.ensureDesktopDataReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `No se pudo preparar la data inicial para login desktop: ${message}`,
      );
      throw new ServiceUnavailableException(
        'No fue posible preparar los catalogos iniciales del escritorio. Verifica la conexion con el servidor central e intentalo de nuevo.',
      );
    }
  }

  private async registerFailedLogin(user: User) {
    const MAX_ATTEMPTS = 3;
    const LOCK_MINUTES = 15;
    const now = new Date();

    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;

    if (user.failedLoginAttempts >= MAX_ATTEMPTS) {
      user.lockUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000);
    }

    await this.usersRepo.save(user);
  }

  private async resetLoginAttempts(user: User) {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await this.usersRepo.save(user);
  }

  private getSessionExpiresAt(): Date {
    const SESSION_DAYS = 30;
    return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  }

  private async createAuthenticatedResponse(
    user: User,
    ip: string | undefined,
    userAgent: string | undefined,
    message: string,
  ) {
    const session = await this.sessionsRepo.save(
      this.sessionsRepo.create({
        user,
        expiresAt: this.getSessionExpiresAt(),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      }),
    );

    const payload: AppJwtPayload = {
      sub: user.id,
      rol: user.rol,
      nombre: user.nombre,
      email: user.email,
      jti: session.id,
    };

    await this.authEvents.logSuccess(user, ip, userAgent);

    return {
      message,
      token: generateJWT(payload),
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      },
    };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    let user = await this.users.findByEmail(dto.email);
    let hydrationFailed = false;

    if (!user) {
      const hydrated = await this.tryHydrateUsersForDesktopLogin(dto.email);
      if (hydrated) {
        user = hydrated.user;
        hydrationFailed = hydrated.hydrationFailed;
      }
    }

    if (!user) {
      await this.authEvents.logFailure(dto.email, ip, userAgent);
      if (hydrationFailed) {
        throw new ServiceUnavailableException(
          'No fue posible sincronizar usuarios con el servidor central en este momento.',
        );
      }
      throw new NotFoundException('El e-mail no existe');
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      await this.authEvents.logFailure(dto.email, ip, userAgent);
      throw new ForbiddenException(
        'La cuenta está bloqueada temporalmente por intentos fallidos. Inténtalo más tarde.',
      );
    }

    if (!user.confirmed) {
      await this.authEvents.logFailure(dto.email, ip, userAgent);
      throw new ForbiddenException('Cuenta no confirmada');
    }

    const ok = await checkPassword(dto.password, user.password);
    if (!ok) {
      await this.registerFailedLogin(user);
      await this.authEvents.logFailure(dto.email, ip, userAgent);

      if (user.lockUntil && user.lockUntil > new Date()) {
        throw new ForbiddenException(
          'La cuenta se ha bloqueado temporalmente por intentos fallidos.',
        );
      }

      throw new UnauthorizedException('Contraseña incorrecta');
    }

    if (user.rol === Role.Unassigned) {
      await this.authEvents.logFailure(dto.email, ip, userAgent);
      throw new ForbiddenException('Rol pendiente de asignación');
    }

    await this.resetLoginAttempts(user);
    await this.ensureDesktopDataReadyForLogin();

    return this.createAuthenticatedResponse(
      user,
      ip,
      userAgent,
      'Autenticado...',
    );
  }

  async loginWithOAuthUser(user: User, ip?: string, userAgent?: string) {
    if (!user.confirmed) {
      throw new ForbiddenException('Cuenta no confirmada');
    }

    if (user.rol === Role.Unassigned) {
      throw new ForbiddenException('Rol pendiente de asignación');
    }

    return this.createAuthenticatedResponse(
      user,
      ip,
      userAgent,
      'Autenticado con proveedor externo...',
    );
  }

  async logout(jti: string) {
    const session = await this.sessionsRepo.findOne({ where: { id: jti } });
    if (!session) {
      return;
    }

    session.revoked = true;
    await this.sessionsRepo.save(session);
  }

  async logoutAll(userId: string) {
    await this.sessionsRepo.update(
      { user: { id: userId }, revoked: false },
      { revoked: true },
    );
  }
}
