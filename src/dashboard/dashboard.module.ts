import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserLoginLog } from '../auth/entities/user-login-log.entity';
import { DailyClosing } from '../history/entities/daily-closing.entity';
import { ServiceOrder } from '../services/entities/service-order.entity';
import { User } from '../users/entities/user.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceOrder, User, UserLoginLog, DailyClosing]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
