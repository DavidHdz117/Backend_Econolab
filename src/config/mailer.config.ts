import { createTransport, Transporter } from 'nodemailer';
import { IntegrationPolicyService } from '../runtime/integration-policy.service';

export const mailerConfig = (
  integrationPolicy: IntegrationPolicyService,
): Transporter => {
  const { user, pass } = integrationPolicy.mailCredentials;

  if (!integrationPolicy.mailEnabled || !user || !pass) {
    return createTransport({
      jsonTransport: true,
    });
  }

  return createTransport({
    service: 'gmail',
    auth: {
      user,
      pass,
    },
  });
};
