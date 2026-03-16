import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResultsService } from './results.service';
import { ResultsController } from './results.controller';
import { StudyResult, StudyResultValue } from './entities/study-result.entity';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import { StudyDetail } from '../studies/entities/study-detail.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StudyResult,
      StudyResultValue,
      ServiceOrder,
      ServiceOrderItem,
      StudyDetail,
    ]),
  ],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
