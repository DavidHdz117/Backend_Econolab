import {ForbiddenException, Injectable, NotFoundException, UnauthorizedException} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UsersService } from 'src/users/users.service';
import { checkPassword } from 'src/common/utils/crypto.util';
import { LoginDto } from './dto/login.dto';
import { generateJWT, AppJwtPayload } from 'src/common/utils/jwt.util';
import { Role } from 'src/common/enums/roles.enum';
import { AuthEventsService } from './auth-events.service';

import { UserSession } from './entities/user-session.entity';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly authEvents: AuthEventsService,

    @InjectRepository(UserSession)
    private readonly sessionsRepo: Repository<UserSession>,

    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) { }

  /* ───────────────────────── Helpers internos ───────────────────────── */

  // Bloqueo por intentos fallidos
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

  /* ───────────────────────── Login ───────────────────────── */
  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      await this.authEvents.logFailure(dto.email, ip, userAgent);
      throw new NotFoundException('El e-mail no existe');
    }

    // Cuenta bloqueada por intentos fallidos
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

    // Login normal para cualquier rol con sesión
    await this.resetLoginAttempts(user);

    const expiresAt = this.getSessionExpiresAt();

    const session = await this.sessionsRepo.save(
      this.sessionsRepo.create({
        user,
        expiresAt,
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

    const token = generateJWT(payload);

    await this.authEvents.logSuccess(user, ip, userAgent);

    return {
      message: 'Autenticado...',
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      },
    };
  }

  /* ───────────────────────── OAuth (Google, etc.) ───────────────────────── */
  async loginWithOAuthUser(user: User, ip?: string, userAgent?: string) {
    if (!user.confirmed) {
      throw new ForbiddenException('Cuenta no confirmada');
    }

    if (user.rol === Role.Unassigned) {
      throw new ForbiddenException('Rol pendiente de asignación');
    }

    const expiresAt = this.getSessionExpiresAt();

    const session = await this.sessionsRepo.save(
      this.sessionsRepo.create({
        user,
        expiresAt,
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

    const token = generateJWT(payload);

    await this.authEvents.logSuccess(user, ip, userAgent);

    return {
      message: 'Autenticado con proveedor externo...',
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      },
    };
  }

  /* ───────────────────────── Logout ───────────────────────── */

  async logout(jti: string) {
    const session = await this.sessionsRepo.findOne({ where: { id: jti } });
    if (!session) return; // idempotente
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
