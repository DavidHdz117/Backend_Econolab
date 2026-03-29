import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { mailerConfig } from '../config/mailer.config';
import { IntegrationPolicyService } from '../runtime/integration-policy.service';
import { MAILER_TRANSPORT } from './constants';
import { MailService } from './mail.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAILER_TRANSPORT,
      inject: [IntegrationPolicyService],
      useFactory: mailerConfig,
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
