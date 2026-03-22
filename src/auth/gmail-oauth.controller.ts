import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { google } from 'googleapis';

@Controller('gmail')
export class GmailOauthController {
  private readonly oauth2: InstanceType<typeof google.auth.OAuth2>;

  constructor(private readonly config: ConfigService) {
    this.oauth2 = new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  @Get('auth')
  start(@Res() res: Response) {
    const url = this.oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.send'],
    });

    res.redirect(url);
  }

  @Get('callback')
  async callback(@Query('code') code: string) {
    const { tokens } = await this.oauth2.getToken(code);
    return tokens;
  }
}
