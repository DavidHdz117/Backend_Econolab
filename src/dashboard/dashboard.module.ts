import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserLoginLog } from '../auth/entities/user-login-log.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { DailyClosing } from '../history/entities/daily-closing.entity';
import { Patient } from '../patients/entities/patient.entity';
import { ServiceOrder } from '../services/entities/service-order.entity';
import { Study } from '../studies/entities/study.entity';
import { User } from '../users/entities/user.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceOrder,
      User,
      UserLoginLog,
      Doctor,
      DailyClosing,
      Patient,
      Study,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
