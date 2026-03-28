import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLoginLog } from './entities/user-login-log.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthEventsService {
  constructor(
    @InjectRepository(UserLoginLog)
    private readonly logsRepo: Repository<UserLoginLog>,
  ) {}

  async logSuccess(user: User, ip?: string, ua?: string) {
    await this.logsRepo.save(
      this.logsRepo.create({
        user,
        success: true,
        ip: ip ?? null,
        userAgent: ua ?? null,
      }),
    );
  }

  async logFailure(email: string | null, ip?: string, ua?: string) {
    await this.logsRepo.save(
      this.logsRepo.create({
        emailIntent: email ?? null,
        success: false,
        ip: ip ?? null,
        userAgent: ua ?? null,
      }),
    );
  }
}
