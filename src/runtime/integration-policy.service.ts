import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AppRuntimeConfig,
  type AppRuntimeMode,
} from '../config/app.config';
import {
  type IntegrationRuntimeConfig,
} from '../config/integrations.config';

type MailCredentials = {
  user?: string;
  pass?: string;
};

type GoogleAuthCredentials = {
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
};

type GmailOauthCredentials = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

@Injectable()
export class IntegrationPolicyService {
  constructor(private readonly configService: ConfigService) {}

  private get appRuntimeConfig(): AppRuntimeConfig {
    return this.configService.getOrThrow<AppRuntimeConfig>('app');
  }

  private get integrationRuntimeConfig(): IntegrationRuntimeConfig {
    return this.configService.getOrThrow<IntegrationRuntimeConfig>('integrations');
  }

  get runtimeMode(): AppRuntimeMode {
    return this.appRuntimeConfig.runtimeMode;
  }

  get mailEnabled() {
    return this.integrationRuntimeConfig.mailEnabled;
  }

  get googleAuthEnabled() {
    return this.integrationRuntimeConfig.googleAuthEnabled;
  }

  get gmailOauthEnabled() {
    return this.integrationRuntimeConfig.gmailOauthEnabled;
  }

  get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL')?.trim();
  }

  get mailCredentials(): MailCredentials {
    return {
      user: this.configService.get<string>('GMAIL_USER')?.trim(),
      pass: this.configService.get<string>('GMAIL_PASS')?.trim(),
    };
  }

  get googleAuthCredentials(): GoogleAuthCredentials {
    return {
      clientId: this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim(),
      clientSecret: this.configService
        .get<string>('GOOGLE_CLIENT_SECRET')
        ?.trim(),
      callbackUrl: this.configService.get<string>('GOOGLE_CALLBACK_URL')?.trim(),
    };
  }

  get gmailOauthCredentials(): GmailOauthCredentials {
    return {
      clientId: this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim(),
      clientSecret: this.configService
        .get<string>('GOOGLE_CLIENT_SECRET')
        ?.trim(),
      redirectUri: this.configService.get<string>('GOOGLE_REDIRECT_URI')?.trim(),
    };
  }

  get mailConfigured() {
    const { user, pass } = this.mailCredentials;
    return Boolean(user && pass);
  }

  get googleAuthConfigured() {
    const { clientId, clientSecret, callbackUrl } = this.googleAuthCredentials;
    return Boolean(clientId && clientSecret && callbackUrl);
  }

  get gmailOauthConfigured() {
    const { clientId, clientSecret, redirectUri } = this.gmailOauthCredentials;
    return Boolean(clientId && clientSecret && redirectUri);
  }

  private throwDisabledFeature(featureLabel: string) {
    throw new ServiceUnavailableException(
      `${featureLabel} esta deshabilitado en el runtime ${this.runtimeMode}. Esta operacion requiere servicios online.`,
    );
  }

  private throwMissingConfiguration(
    featureLabel: string,
    variableNames: string[],
  ) {
    throw new ServiceUnavailableException(
      `${featureLabel} no esta configurado correctamente. Faltan: ${variableNames.join(', ')}.`,
    );
  }

  assertMailEnabled(featureLabel = 'El envio de correo') {
    if (!this.mailEnabled) {
      this.throwDisabledFeature(featureLabel);
    }

    const { user, pass } = this.mailCredentials;
    const missingVariables = [
      !user ? 'GMAIL_USER' : null,
      !pass ? 'GMAIL_PASS' : null,
    ].filter((value): value is string => Boolean(value));

    if (missingVariables.length > 0) {
      this.throwMissingConfiguration(featureLabel, missingVariables);
    }
  }

  assertFrontendUrlConfigured(featureLabel = 'Los enlaces del frontend') {
    if (this.frontendUrl) {
      return;
    }

    this.throwMissingConfiguration(featureLabel, ['FRONTEND_URL']);
  }

  assertGoogleAuthEnabled(featureLabel = 'El inicio de sesion con Google') {
    if (!this.googleAuthEnabled) {
      this.throwDisabledFeature(featureLabel);
    }

    const { clientId, clientSecret, callbackUrl } = this.googleAuthCredentials;
    const missingVariables = [
      !clientId ? 'GOOGLE_CLIENT_ID' : null,
      !clientSecret ? 'GOOGLE_CLIENT_SECRET' : null,
      !callbackUrl ? 'GOOGLE_CALLBACK_URL' : null,
    ].filter((value): value is string => Boolean(value));

    if (missingVariables.length > 0) {
      this.throwMissingConfiguration(featureLabel, missingVariables);
    }
  }

  assertGmailOauthEnabled(featureLabel = 'La autorizacion de Gmail') {
    if (!this.gmailOauthEnabled) {
      this.throwDisabledFeature(featureLabel);
    }

    const { clientId, clientSecret, redirectUri } = this.gmailOauthCredentials;
    const missingVariables = [
      !clientId ? 'GOOGLE_CLIENT_ID' : null,
      !clientSecret ? 'GOOGLE_CLIENT_SECRET' : null,
      !redirectUri ? 'GOOGLE_REDIRECT_URI' : null,
    ].filter((value): value is string => Boolean(value));

    if (missingVariables.length > 0) {
      this.throwMissingConfiguration(featureLabel, missingVariables);
    }
  }
}
