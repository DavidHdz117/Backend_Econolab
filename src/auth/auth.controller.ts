import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthAvailabilityGuard } from './guards/google-auth-availability.guard';
import { User } from '../users/entities/user.entity';
import {
  AuthenticatedUser,
  RequestWithUser,
} from '../common/types/auth-request.type';
import { IntegrationPolicyService } from '../runtime/integration-policy.service';

@UsePipes(new ValidationPipe({ transform: true }))
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly integrationPolicy: IntegrationPolicyService,
  ) {}

  @Post('login')
  login(@Req() req: Request, @Body() dto: LoginDto) {
    const ua = req.get('user-agent') ?? undefined;
    const ip = req.ip || undefined;
    return this.auth.login(dto, ip, ua);
  }

  @Get('google')
  googleLogin(@Res() res: Response) {
    this.integrationPolicy.assertGoogleAuthEnabled(
      'El inicio de sesion con Google',
    );

    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.config.get<string>('GOOGLE_CALLBACK_URL');

    const root = 'https://accounts.google.com/o/oauth2/v2/auth';

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri!,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
    });

    const googleUrl = `${root}?${params.toString()}`;
    console.log('Redirect a Google:', googleUrl);

    res.redirect(googleUrl);
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthAvailabilityGuard, AuthGuard('google'))
  async googleCallback(
    @Req() req: RequestWithUser<User>,
    @Res() res: Response,
  ) {
    const ua = req.get('user-agent') ?? undefined;
    const ip = req.ip || undefined;
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';

    try {
      const result = await this.auth.loginWithOAuthUser(req.user, ip, ua);
      const url =
        `${frontendUrl}/auth/google` +
        `?token=${encodeURIComponent(result.token)}` +
        `&message=${encodeURIComponent(
          result.message ?? 'Autenticado con Google',
        )}` +
        `&email=${encodeURIComponent(result.usuario.email)}` +
        `&rol=${encodeURIComponent(result.usuario.rol)}`;

      console.log('REDIRECT FRONT:', url.toString());
      res.redirect(url.toString());
      return;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo completar el inicio de sesion con Google';

      res.redirect(
        `${frontendUrl}/auth/google?error=${encodeURIComponent(message)}`,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: RequestWithUser<AuthenticatedUser>) {
    await this.auth.logout(req.user.jti);
    return { message: 'Sesion cerrada' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Req() req: RequestWithUser<AuthenticatedUser>) {
    await this.auth.logoutAll(req.user.id);
    return { message: 'Todas las sesiones fueron cerradas' };
  }
}
