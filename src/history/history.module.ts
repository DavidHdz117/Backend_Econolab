import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceOrder } from '../services/entities/service-order.entity';
import { DailyClosing } from './entities/daily-closing.entity';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceOrder, DailyClosing])],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
