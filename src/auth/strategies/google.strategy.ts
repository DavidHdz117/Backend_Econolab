import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy as any,
  'google',
) {
  constructor(
    private readonly cfg: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      clientID: cfg.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: cfg.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: cfg.get<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    } as any);
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    const email = profile.emails?.[0]?.value;
    const nombre = profile.displayName;

    if (!email) {
      throw new UnauthorizedException(
        'No se pudo obtener el email desde Google',
      );
    }

    // 1) Buscar usuario por email
    let user = await this.usersService.findByEmail(email);

    // 2) Si NO existe → crearlo como ADMIN (SOLO pruebas)
    if (!user) {
      user = await this.usersService.registerFromGoogleAsAdmin({
        nombre,
        email,
        googleId: profile.id,
      });
    }

    // 3) Si existe pero no está confirmado → confirmarlo
    if (!user.confirmed) {
      user = await this.usersService.confirmFromGoogle(user);
    }

    // 4) ⚠️ SOLO pruebas: si sigue unassigned, darle admin
    user = await this.usersService.promoteUnassignedToAdminForTesting(user);

    // Passport pondrá este user en req.user
    return user;
  }
}
