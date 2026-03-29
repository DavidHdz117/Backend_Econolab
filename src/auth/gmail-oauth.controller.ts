import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { google } from 'googleapis';
import { IntegrationPolicyService } from '../runtime/integration-policy.service';

@Controller('gmail')
export class GmailOauthController {
  private readonly oauth2: InstanceType<typeof google.auth.OAuth2>;

  constructor(private readonly integrationPolicy: IntegrationPolicyService) {
    const { clientId, clientSecret, redirectUri } =
      this.integrationPolicy.gmailOauthCredentials;

    this.oauth2 = new google.auth.OAuth2(
      clientId || 'gmail-oauth-disabled-client',
      clientSecret || 'gmail-oauth-disabled-secret',
      redirectUri || 'http://localhost/gmail-oauth-disabled/callback',
    );
  }

  @Get('auth')
  start(@Res() res: Response) {
    this.integrationPolicy.assertGmailOauthEnabled(
      'La autorizacion manual de Gmail',
    );

    const url = this.oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.send'],
    });

    res.redirect(url);
  }

  @Get('callback')
  async callback(@Query('code') code: string) {
    this.integrationPolicy.assertGmailOauthEnabled(
      'La autorizacion manual de Gmail',
    );

    const { tokens } = await this.oauth2.getToken(code);
    return tokens;
  }
}
