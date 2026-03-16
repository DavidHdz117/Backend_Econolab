import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy as any, 'google') {
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
    const googleAvatarUrl = profile.photos?.[0]?.value ?? null;

    if (!email) {
      throw new UnauthorizedException('No se pudo obtener el email desde Google');
    }

    let user = await this.usersService.findByEmail(email);

    if (!user) {
      user = await this.usersService.registerFromGoogle({
        nombre,
        email,
        googleId: profile.id,
        googleAvatarUrl,
      });
    }

    if (!user.confirmed) {
      user = await this.usersService.confirmFromGoogle(user, googleAvatarUrl);
    } else {
      user = await this.usersService.syncGoogleAvatar(user, googleAvatarUrl);
    }

    return user;
  }
}
