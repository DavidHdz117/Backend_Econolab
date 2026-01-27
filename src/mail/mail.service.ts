import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, gmail_v1 } from 'googleapis';

export interface EmailPayload {
  nombre: string;
  email: string;
  token: string;
}

@Injectable()
export class MailService {
  private oauth2: any;
  private gmail: gmail_v1.Gmail;

  constructor(private readonly config: ConfigService) {
    this.oauth2 = new google.auth.OAuth2(
      this.config.get('GOOGLE_CLIENT_ID'),
      this.config.get('GOOGLE_CLIENT_SECRET'),
      this.config.get('GOOGLE_REDIRECT_URI'),
    );

    this.oauth2.setCredentials({
      refresh_token: this.config.get('GOOGLE_REFRESH_TOKEN'),
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2 });
  }

  // 🔹 método interno para enviar
  private async sendEmail(to: string, subject: string, html: string) {
    const fromEmail = this.config.get('GMAIL_USER');
    const fromName = 'Econolab Huejutla';

    const message =
      `From: ${fromName} <${fromEmail}>\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${subject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n\r\n` +
      html;

    const raw = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
  }

  // =========================
  // TUS MÉTODOS (IGUALES)
  // =========================

  async sendConfirmationEmail({ nombre, email, token }: EmailPayload) {
    await this.sendEmail(
      email,
      'Econolab Huejutla – Confirma tu cuenta',
      `
        <p>Hola ${nombre}, has creado tu cuenta en Econolab Huejutla, ya casi está lista.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${this.config.get('FRONTEND_URL')}/auth/confirm-account">
          Confirmar cuenta
        </a>
        <p>e ingresa el código: <b>${token}</b></p>
      `,
    );
  }

  async sendPasswordResetToken({ nombre, email, token }: EmailPayload) {
    await this.sendEmail(
      email,
      'Econolab Huejutla – Restablece tu contraseña',
      `
        <p>Hola ${nombre}, has solicitado restablecer tu contraseña.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${this.config.get('FRONTEND_URL')}/auth/new-password">
          Restablecer contraseña
        </a>
        <p>e ingresa el código: <b>${token}</b></p>
      `,
    );
  }

  async sendMfaCode(payload: { nombre: string; email: string; code: string }) {
    const { nombre, email, code } = payload;

    await this.sendEmail(
      email,
      'Econolab Huejutla – Código de verificación',
      `
        <p>Hola ${nombre},</p>
        <p>Tu código de verificación es:</p>
        <h2 style="font-size: 24px; margin: 10px 0; color: #333;">
          ${code}
        </h2>
        <p>Ingresa este código para continuar con tu verificación.</p>
        <p>Si no solicitaste este código, puedes ignorar este mensaje.</p>
      `,
    );
  }
}
