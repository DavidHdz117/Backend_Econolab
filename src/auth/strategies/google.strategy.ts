import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { UsersService } from 'src/users/users.service';
import { IntegrationPolicyService } from '../../runtime/integration-policy.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy as any,
  'google',
) {
  constructor(
    private readonly usersService: UsersService,
    private readonly integrationPolicy: IntegrationPolicyService,
  ) {
    const { clientId, clientSecret, callbackUrl } =
      integrationPolicy.googleAuthCredentials;

    super({
      clientID: clientId || 'google-auth-disabled-client',
      clientSecret: clientSecret || 'google-auth-disabled-secret',
      callbackURL:
        callbackUrl || 'http://localhost/google-auth-disabled/callback',
      scope: ['email', 'profile'],
    } as any);
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ) {
    if (!this.integrationPolicy.googleAuthEnabled) {
      throw new ServiceUnavailableException(
        'El inicio de sesion con Google esta deshabilitado en este runtime.',
      );
    }

    const email = profile.emails?.[0]?.value;
    const nombre = profile.displayName;
    const googleAvatarUrl = profile.photos?.[0]?.value ?? null;

    if (!email) {
      throw new UnauthorizedException(
        'No se pudo obtener el email desde Google',
      );
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
