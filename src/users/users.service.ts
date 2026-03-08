import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './entities/user.entity';
import { checkPassword, hashPassword } from 'src/common/utils/crypto.util';
import { generateRandomToken } from 'src/common/utils/token.util';
import { Role } from 'src/common/enums/roles.enum';
import { MailService } from 'src/mail/mail.service';



@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly mailService: MailService
  ) { }

  async registerFailedLogin(user: User) {
    const MAX_ATTEMPTS = 3;
    const LOCK_MINUTES = 15;
    const now = new Date();

    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;

    if (user.failedLoginAttempts >= MAX_ATTEMPTS) {
      user.lockUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000);
    }

    await this.userRepository.save(user);
  }

  async resetLoginAttempts(user: User) {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await this.userRepository.save(user);
  }

  /* ───────── Registro ───────── */
  async register(dto: CreateUserDto) {
    const exists = await this.findByEmail(dto.email);
    if (exists) throw new ConflictException('El correo ya está en uso');

    return this.create(dto);
  }

  /* ───────── Confirmar cuenta ───────── */
  async confirmAccount(token: string) {
    const user = await this.findByToken(token);
    if (!user) throw new NotFoundException('Token no válido');

    user.confirmed = true;
    user.token = null;
    await this.userRepository.save(user);

    return { message: 'Cuenta confirmada correctamente' };
  }

  /* ───────── Recuperar contraseña ───────── */
  async forgotPassword(email: string) {
    const user = await this.findByEmail(email);

    // Respuesta genérica SIEMPRE
    const genericResponse = {
      message: 'Si el correo existe, se enviará un enlace de recuperación',
    };

    // Si no existe, no decimos nada; opcional: delay para evitar timing attacks
    if (!user) {
      await new Promise((resolve) => setTimeout(resolve, 300)); // 300ms
      return genericResponse;
    }

    const now = new Date();
    const WINDOW_HOURS = 1;     // ventana de 1 hora
    const MAX_REQUESTS = 3;     // máximo 3 correos por hora

    // Reiniciar ventana si ya pasó la hora
    if (
      !user.resetRequestWindowStart ||
      now.getTime() - user.resetRequestWindowStart.getTime() >
      WINDOW_HOURS * 60 * 60 * 1000
    ) {
      user.resetRequestWindowStart = now;
      user.resetRequestCount = 0;
    }

    // Si ya se pasó del límite, no mandamos más correos
    if (user.resetRequestCount >= MAX_REQUESTS) {
      return {
        message:
          'Ya se envió recientemente un correo de recuperación. Revisa tu bandeja o inténtalo más tarde.',
      };
    }

    // Generar token "serio" y con expiración
    user.token = generateRandomToken(6); // mejor que 6 dígitos
    user.resetTokenExpiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hora
    user.resetRequestCount++;
    await this.userRepository.save(user);

    await this.mailService.sendPasswordResetToken({
      nombre: user.nombre,
      email: user.email,
      token: user.token,
    });

    return genericResponse;
  }


  /* ───────── Validar token de reset ───────── */
  async validateResetToken(token: string) {
    const user = await this.findByToken(token);
    const now = new Date();

    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < now) {
      throw new NotFoundException('Token no válido o expirado');
    }

    return { message: 'Token válido...' };
  }


  /* ───────── Reset con token ───────── */
  async resetPassword(token: string, newPass: string) {
    const user = await this.findByToken(token);
    const now = new Date();

    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < now) {
      throw new NotFoundException('Token no válido o expirado');
    }

    user.password = await hashPassword(newPass);
    user.token = null;
    user.resetTokenExpiresAt = null;
    // Podrías resetear también contador de solicitudes si quieres:
    user.resetRequestCount = 0;
    user.resetRequestWindowStart = null;

    await this.userRepository.save(user);

    return { message: 'La contraseña se modificó correctamente' };
  }


  /* ───────── Cambiar contraseña autenticado ───────── */
  async updatePassword(userId: string, currentPass: string, newPass: string) {
    const user = await this.findOne(userId);
    const ok = await checkPassword(currentPass, user!.password);
    if (!ok) throw new UnauthorizedException('Contraseña actual incorrecta');

    user!.password = await hashPassword(newPass);
    await this.userRepository.save(user!);

    return { message: 'Contraseña actualizada' };
  }

  /* ───────── Verificar contraseña autenticado ───────── */
  async checkPassword(userId: string, pass: string) {
    const user = await this.findOne(userId);
    const ok = await checkPassword(pass, user!.password);
    if (!ok) throw new UnauthorizedException('Contraseña incorrecta');
    return { message: 'Contraseña correcta' };
  }


  /* ───────── Funciones de administrador ───────── */
  async findConfirmed() {
    return this.userRepository.find({ where: { confirmed: true } });
  }

  async setRole(id: string, rol: Role) {

    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.confirmed) throw new UnauthorizedException('El usuario no ha confirmado su cuenta');
    user.rol = rol;
    await this.userRepository.save(user);
    return { message: 'Rol actualizado', usuario: { id: user.id, rol } };
  }

  async findConfirmedUnassigned() {
    const users = await this.userRepository.find({
      where: {
        confirmed: true,
        rol: Role.Unassigned, // enum o null, según tu columna
      },
      order: { createdAt: 'ASC' }, // opcional: ordena por fecha de alta
    });
    if (users !== null) return users;
    return { message: 'No hay usuarios sin rol' };
  }

  async findConfirmedWithRoles() {
    const users = await this.userRepository.find({
      where: [
        { confirmed: true, rol: Role.Recepcionista || Role.Admin },
      ],
      order: { createdAt: 'ASC' },
    });
    if (users !== null) return users;
    return { message: 'No hay usuarios con rol' };
  }

  /* ───────── Eliminar usuario (solo admin) ───────── */
  async deleteUser(id: string) {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.rol === Role.Admin) {
      throw new UnauthorizedException('No se puede eliminar un usuario admin');
    }

    await this.userRepository.remove(user);

    return { message: 'Usuario eliminado' };
  }


  /* ───────── CRUD helpers ───────── */
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
      rol: Role.Admin,
      password: await hashPassword(dto.password),
      token: generateRandomToken(6),
      confirmed: false,
    });
    await this.userRepository.save(user);
    return user;
  }

  async getRoleOnly(id: string): Promise<Role | null> {
    const record = await this.userRepository.findOne({
      where: { id },
      select: ['rol'],          // ← solo la columna rol (rápido)
    });
    return record?.rol ?? null;
  }

  async registerFromGoogleAsAdmin(data: {
    nombre: string;
    email: string;
    googleId: string;
  }) {
    const randomPass = await hashPassword(
      `google-${data.email}-${Date.now()}`
    );

    const user = this.userRepository.create({
      nombre: data.nombre,
      email: data.email,
      password: randomPass,
      confirmed: true,
      rol: Role.Admin,        // 👈 ADMIN directo (SOLO pruebas)
      // si tu entidad tiene estos campos, puedes guardarlos:
      // googleId: data.googleId,
      // provider: 'google',
    });

    return this.userRepository.save(user);
  }

  /** Marcar usuario como confirmado (si viene de Google) */
  async confirmFromGoogle(user: User) {
    user.confirmed = true;
    user.token = null;         // si usas token de confirmación
    return this.userRepository.save(user);
  }

  /** ⚠️ SOLO PRUEBAS: promover a admin si sigue unassigned */
  async promoteUnassignedToAdminForTesting(user: User) {
    if (user.rol === Role.Unassigned) {
      user.rol = Role.Admin;
      return this.userRepository.save(user);
    }
    return user;
  }
}
