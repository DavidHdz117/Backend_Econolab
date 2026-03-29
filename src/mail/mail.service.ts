import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Transporter } from 'nodemailer';
import { IntegrationPolicyService } from '../runtime/integration-policy.service';
import { MAILER_TRANSPORT } from './constants';

interface EmailPayload {
  nombre: string;
  email: string;
  token: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly integrationPolicy: IntegrationPolicyService,
    @Inject(MAILER_TRANSPORT)
    private readonly transporter: Transporter,
  ) {}

  assertDeliveryAvailable(featureLabel = 'El envio de correo') {
    this.integrationPolicy.assertMailEnabled(featureLabel);
  }

  private getFrontendUrlOrThrow(featureLabel: string) {
    this.integrationPolicy.assertFrontendUrlConfigured(featureLabel);
    return this.integrationPolicy.frontendUrl!;
  }

  private async sendEmail(to: string, subject: string, html: string) {
    this.assertDeliveryAvailable();

    const fromEmail = this.integrationPolicy.mailCredentials.user;
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
    const frontendUrl = this.getFrontendUrlOrThrow(
      'La confirmacion de cuenta por correo',
    );

    await this.sendEmail(
      email,
      'Econolab Huejutla - Confirma tu cuenta',
      `
        <p>Hola ${nombre}, has creado tu cuenta en Econolab Huejutla, ya casi esta lista.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${frontendUrl}/auth/confirm-account">
          Confirmar cuenta
        </a>
        <p>e ingresa el codigo: <b>${token}</b></p>
      `,
    );
  }

  async sendPasswordResetToken({ nombre, email, token }: EmailPayload) {
    const frontendUrl = this.getFrontendUrlOrThrow(
      'La recuperacion de contrasena por correo',
    );

    await this.sendEmail(
      email,
      'Econolab Huejutla - Restablece tu contrasena',
      `
        <p>Hola ${nombre}, has solicitado restablecer tu contrasena.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${frontendUrl}/auth/new-password">
          Restablecer contrasena
        </a>
        <p>e ingresa el codigo: <b>${token}</b></p>
      `,
    );
  }
}
