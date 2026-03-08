import {Body, Controller, Get, Post, Req, Res, UseGuards, UsePipes, ValidationPipe,} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) { }

  /* ───────── Login con usuario/contraseña ───────── */
  @Post('login')
  login(@Req() req, @Body() dto: LoginDto) {
    const ua = (req.headers['user-agent'] as string) || undefined;
    const ip = (req.ip as string) || undefined;
    return this.auth.login(dto, ip, ua);
  }

  /* ───────── OAuth2 con Google ───────── */

  // Inicia el flujo: redirige a Google para autenticación
  @Get('google')
  googleLogin(@Res() res: Response) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.config.get<string>('GOOGLE_CALLBACK_URL');

    const root = 'https://accounts.google.com/o/oauth2/v2/auth';

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri!,                 // http://localhost:3000/api/auth/google/callback
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',                          // fuerza selector de cuenta
    });

    const googleUrl = `${root}?${params.toString()}`;

    console.log('🔁 Redirect a Google:', googleUrl);

    return res.redirect(googleUrl);
  }

  // Callback de Google después de autenticarse
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req, @Res() res) {
    const ua = (req.headers['user-agent'] as string) || undefined;
    const ip = (req.ip as string) || undefined;

    const result = await this.auth.loginWithOAuthUser(req.user, ip, ua);
    // result = { message, token, usuario }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const url =
    `${frontendUrl}/auth/google` +
    `?token=${encodeURIComponent(result.token)}` +
    `&message=${encodeURIComponent(result.message ?? 'Autenticado con Google')}` +
    `&email=${encodeURIComponent(result.usuario.email)}` +
    `&rol=${encodeURIComponent(result.usuario.rol)}`;

    console.log('REDIRECT FRONT:', url.toString());

    return res.redirect(url.toString());
  }

  /* ───────── Logout ───────── */

  // Cierra sólo la sesión actual (token actual)
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req) {
    await this.auth.logout(req.user.jti);
    return { message: 'Sesión cerrada' };
  }

  // Cierra todas las sesiones del usuario
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Req() req) {
    await this.auth.logoutAll(req.user.id);
    return { message: 'Todas las sesiones fueron cerradas' };
  }
}
