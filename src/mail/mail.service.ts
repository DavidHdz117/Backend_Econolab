import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transporter } from 'nodemailer';
import { MAILER_TRANSPORT } from './constants';

export interface EmailPayload {
  nombre: string;
  email: string;
  token: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(MAILER_TRANSPORT)
    private readonly transporter: Transporter,
  ) {}

  private async sendEmail(to: string, subject: string, html: string) {
    const fromEmail = this.config.get<string>('GMAIL_USER');
    const fromName = 'Econolab Huejutla';

    if (!fromEmail) {
      throw new ServiceUnavailableException('GMAIL_USER no esta configurado');
    }

    try {
      await this.transporter.sendMail({
        from: `${fromName} <${fromEmail}>`,
        to,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error('Fallo al enviar correo', error as Error);
      throw new ServiceUnavailableException(
        'No se pudo enviar el correo en este momento',
      );
    }
  }

  async sendConfirmationEmail({ nombre, email, token }: EmailPayload) {
    await this.sendEmail(
      email,
      'Econolab Huejutla - Confirma tu cuenta',
      `
        <p>Hola ${nombre}, has creado tu cuenta en Econolab Huejutla, ya casi esta lista.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${this.config.get('FRONTEND_URL')}/auth/confirm-account">
          Confirmar cuenta
        </a>
        <p>e ingresa el codigo: <b>${token}</b></p>
      `,
    );
  }

  async sendPasswordResetToken({ nombre, email, token }: EmailPayload) {
    await this.sendEmail(
      email,
      'Econolab Huejutla - Restablece tu contrasena',
      `
        <p>Hola ${nombre}, has solicitado restablecer tu contrasena.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${this.config.get('FRONTEND_URL')}/auth/new-password">
          Restablecer contrasena
        </a>
        <p>e ingresa el codigo: <b>${token}</b></p>
      `,
    );
  }

  async sendMfaCode(payload: { nombre: string; email: string; code: string }) {
    const { nombre, email, code } = payload;

    await this.sendEmail(
      email,
      'Econolab Huejutla - Codigo de verificacion',
      `
        <p>Hola ${nombre},</p>
        <p>Tu codigo de verificacion es:</p>
        <h2 style="font-size: 24px; margin: 10px 0; color: #333;">
          ${code}
        </h2>
        <p>Ingresa este codigo para continuar con tu verificacion.</p>
        <p>Si no solicitaste este codigo, puedes ignorar este mensaje.</p>
      `,
    );
  }
}
