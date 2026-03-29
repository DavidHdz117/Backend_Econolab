import { registerAs } from '@nestjs/config';
import { getAppRuntimeConfig } from './app.config';
import { parseBooleanEnv } from './env.utils';

export function getIntegrationRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
) {
  const { runtimeMode } = getAppRuntimeConfig(env);

  return {
    mailEnabled: parseBooleanEnv(
      env.APP_MAIL_ENABLED,
      runtimeMode !== 'desktop-offline',
    ),
    googleAuthEnabled: parseBooleanEnv(
      env.APP_GOOGLE_AUTH_ENABLED,
      runtimeMode !== 'desktop-offline',
    ),
    gmailOauthEnabled: parseBooleanEnv(
      env.APP_GMAIL_OAUTH_ENABLED,
      runtimeMode === 'web-online',
    ),
  };
}

export type IntegrationRuntimeConfig = ReturnType<
  typeof getIntegrationRuntimeConfig
>;

export const integrationsConfig = registerAs('integrations', () =>
  getIntegrationRuntimeConfig(),
);
