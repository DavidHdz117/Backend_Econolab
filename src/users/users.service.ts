import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './entities/user.entity';
import { checkPassword, hashPassword } from 'src/common/utils/crypto.util';
import { generateRandomToken } from 'src/common/utils/token.util';
import { Role } from 'src/common/enums/roles.enum';
import { MailService } from 'src/mail/mail.service';
import { generateJWT, type AppJwtPayload } from 'src/common/utils/jwt.util';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
  ) {}

  async register(dto: CreateUserDto) {
    const exists = await this.findByEmail(dto.email);
    if (exists) throw new ConflictException('El correo ya esta en uso');

    return this.create(dto);
  }

  async confirmAccount(token: string) {
    const user = await this.findByToken(token);
    if (!user) throw new NotFoundException('Token no valido');

    user.confirmed = true;
    user.token = null;
    await this.userRepository.save(user);

    return {
      message:
        'Cuenta confirmada correctamente. Espera a que un administrador te asigne un rol.',
    };
  }

  async forgotPassword(email: string) {
    const user = await this.findByEmail(email);

    const genericResponse = {
      message: 'Si el correo existe, se enviara un enlace de recuperacion',
    };

    if (!user) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return genericResponse;
    }

    const now = new Date();
    const WINDOW_HOURS = 1;
    const MAX_REQUESTS = 3;

    if (
      !user.resetRequestWindowStart ||
      now.getTime() - user.resetRequestWindowStart.getTime() >
        WINDOW_HOURS * 60 * 60 * 1000
    ) {
      user.resetRequestWindowStart = now;
      user.resetRequestCount = 0;
    }

    if (user.resetRequestCount >= MAX_REQUESTS) {
      return {
        message:
          'Ya se envio recientemente un correo de recuperacion. Revisa tu bandeja o intentalo mas tarde.',
      };
    }

    user.token = generateRandomToken(6);
    user.resetTokenExpiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    user.resetRequestCount++;
    await this.userRepository.save(user);

    await this.mailService.sendPasswordResetToken({
      nombre: user.nombre,
      email: user.email,
      token: user.token,
    });

    return genericResponse;
  }

  async validateResetToken(token: string) {
    const user = await this.findByToken(token);
    const now = new Date();

    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < now) {
      throw new NotFoundException('Token no valido o expirado');
    }

    return { message: 'Token valido...' };
  }

  async resetPassword(token: string, newPass: string) {
    const user = await this.findByToken(token);
    const now = new Date();

    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < now) {
      throw new NotFoundException('Token no valido o expirado');
    }

    user.password = await hashPassword(newPass);
    user.token = null;
    user.resetTokenExpiresAt = null;
    user.resetRequestCount = 0;
    user.resetRequestWindowStart = null;

    await this.userRepository.save(user);

    return { message: 'La contrasena se modifico correctamente' };
  }

  async updatePassword(userId: string, currentPass: string, newPass: string) {
    const user = await this.findOne(userId);
    const ok = await checkPassword(currentPass, user!.password);
    if (!ok) throw new UnauthorizedException('Contrasena actual incorrecta');

    user!.password = await hashPassword(newPass);
    await this.userRepository.save(user!);

    return { message: 'Contrasena actualizada' };
  }

  async getProfile(userId: string) {
    const user = await this.findOne(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return this.toProfileView(user);
  }

  async updateProfileImage(userId: string, file: Express.Multer.File) {
    const user = await this.findOne(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    user.profileImageData = file.buffer.toString('base64');
    user.profileImageMimeType = file.mimetype;

    await this.userRepository.save(user);

    return {
      message: 'Foto de perfil actualizada',
      user: this.toProfileView(user),
    };
  }

  async updateProfile(userId: string, jti: string, dto: UpdateProfileDto) {
    const user = await this.findOne(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const nextNombre = dto.nombre?.trim();
    const nextEmail = dto.email?.trim().toLowerCase();

    if (!nextNombre && !nextEmail) {
      throw new ConflictException('No hay cambios para guardar');
    }

    if (typeof nextNombre === 'string' && nextNombre) {
      user.nombre = nextNombre;
    }

    if (
      typeof nextEmail === 'string' &&
      nextEmail &&
      nextEmail !== user.email
    ) {
      if (user.googleAvatarUrl) {
        throw new ForbiddenException(
          'Las cuentas con Google no pueden cambiar el correo desde este perfil',
        );
      }

      const existingUser = await this.findByEmail(nextEmail);
      if (existingUser && existingUser.id !== user.id) {
        throw new ConflictException('El correo ya esta en uso');
      }

      user.email = nextEmail;
    }

    await this.userRepository.save(user);

    const payload: AppJwtPayload = {
      sub: user.id,
      rol: user.rol,
      nombre: user.nombre,
      email: user.email,
      jti,
    };

    return {
      message: 'Perfil actualizado',
      token: generateJWT(payload),
      user: this.toProfileView(user),
    };
  }

  async checkPassword(userId: string, pass: string) {
    const user = await this.findOne(userId);
    const ok = await checkPassword(pass, user!.password);
    if (!ok) throw new UnauthorizedException('Contrasena incorrecta');
    return { message: 'Contrasena correcta' };
  }

  async setRole(id: string, rol: Role) {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.confirmed) {
      throw new UnauthorizedException('El usuario no ha confirmado su cuenta');
    }
    if (user.rol === Role.Admin) {
      throw new ForbiddenException(
        'No se puede cambiar el rol de un usuario admin desde este panel',
      );
    }

    user.rol = rol;
    await this.userRepository.save(user);

    return {
      message: 'Rol actualizado',
      usuario: this.toAdminUserView(user),
    };
  }

  async findConfirmedUnassigned() {
    const users = await this.userRepository.find({
      where: {
        confirmed: true,
        rol: Role.Unassigned,
      },
      order: { createdAt: 'ASC' },
    });

    return users.map((user) => this.toAdminUserView(user));
  }

  async findConfirmedWithRoles() {
    const users = await this.userRepository.find({
      where: {
        confirmed: true,
        rol: In([Role.Admin, Role.Recepcionista]),
      },
      order: { createdAt: 'ASC' },
    });

    return users.map((user) => this.toAdminUserView(user));
  }

  async deleteUser(id: string) {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.rol === Role.Admin) {
      throw new UnauthorizedException('No se puede eliminar un usuario admin');
    }

    await this.userRepository.remove(user);

    return { message: 'Usuario eliminado' };
  }

  async findOne(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.userRepository.findOne({ where: { email } });
  }

  async findByToken(token: string) {
    return this.userRepository.findOne({ where: { token } });
  }

  async create(dto: CreateUserDto) {
    const user = this.userRepository.create({
      ...dto,
      rol: Role.Unassigned,
      password: await hashPassword(dto.password),
      token: generateRandomToken(6),
      confirmed: false,
    });
    await this.userRepository.save(user);
    return user;
  }

  async registerFromGoogle(data: {
    nombre: string;
    email: string;
    googleId: string;
    googleAvatarUrl?: string | null;
  }) {
    const randomPass = await hashPassword(`google-${data.email}-${Date.now()}`);

    const user = this.userRepository.create({
      nombre: data.nombre,
      email: data.email,
      password: randomPass,
      confirmed: true,
      rol: Role.Unassigned,
      googleAvatarUrl: data.googleAvatarUrl ?? null,
    });

    return this.userRepository.save(user);
  }

  async confirmFromGoogle(user: User, googleAvatarUrl?: string | null) {
    user.confirmed = true;
    user.token = null;

    if (googleAvatarUrl) {
      user.googleAvatarUrl = googleAvatarUrl;
    }

    return this.userRepository.save(user);
  }

  async syncGoogleAvatar(user: User, googleAvatarUrl?: string | null) {
    if (!googleAvatarUrl) {
      return user;
    }

    if (user.googleAvatarUrl === googleAvatarUrl) {
      return user;
    }

    user.googleAvatarUrl = googleAvatarUrl;
    return this.userRepository.save(user);
  }

  private getProfileImageUrl(user: User) {
    if (user.profileImageData && user.profileImageMimeType) {
      return `data:${user.profileImageMimeType};base64,${user.profileImageData}`;
    }

    return user.googleAvatarUrl ?? null;
  }

  private toProfileView(user: User) {
    return {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      confirmed: user.confirmed,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      profileImageUrl: this.getProfileImageUrl(user),
      authProvider: user.googleAvatarUrl ? 'google' : 'local',
    };
  }

  private toAdminUserView(user: User) {
    return {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      confirmed: user.confirmed,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
