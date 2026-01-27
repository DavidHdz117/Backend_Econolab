import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { google } from 'googleapis';

@Controller('gmail') // con globalPrefix = 'api' queda /api/gmail/...
export class GmailOauthController {
    private oauth2: any;

    constructor(private readonly config: ConfigService) {
        this.oauth2 = new google.auth.OAuth2(
            this.config.get<string>('GOOGLE_CLIENT_ID'),
            this.config.get<string>('GOOGLE_CLIENT_SECRET'),
            this.config.get<string>('GOOGLE_REDIRECT_URI'),
        );
    }

    // Abres: http://localhost:3000/api/gmail/auth
    @Get('auth')
    start(@Res() res: Response) {
        const url = this.oauth2.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/gmail.send'],
        });
        return res.redirect(url);
    }

    // Google regresa aquí: http://localhost:3000/api/gmail/callback?code=...
    @Get('callback')
    async callback(@Query('code') code: string) {
        const { tokens } = await this.oauth2.getToken(code);

        // Aquí debe venir refresh_token la primera vez (o tras revocar permisos)
        return tokens;
    }
}
