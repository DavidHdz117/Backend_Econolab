import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthEventsService } from './auth-events.service';
import { GoogleAuthAvailabilityGuard } from './guards/google-auth-availability.guard';
import { GoogleStrategy } from './strategies/google.strategy';

import { UsersModule } from 'src/users/users.module';
import { UserLoginLog } from './entities/user-login-log.entity';
import { User } from 'src/users/entities/user.entity';
import { UserSession } from './entities/user-session.entity';
import { GmailOauthController } from './gmail-oauth.controller';

@Module({
  imports: [
    ConfigModule,
    PassportModule, // o PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([UserLoginLog, User, UserSession]),
    UsersModule,
  ],
  controllers: [AuthController, GmailOauthController],
  providers: [
    AuthService,
    JwtStrategy,
    AuthEventsService,
    GoogleStrategy,
    GoogleAuthAvailabilityGuard,
  ],
  exports: [AuthService, AuthEventsService],
})
export class AuthModule {}
