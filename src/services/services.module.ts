import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import {
  ServiceOrder,
  ServiceOrderItem,
} from './entities/service-order.entity';
import { Patient } from '../patients/entities/patient.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Study } from '../studies/entities/study.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceOrder,
      ServiceOrderItem,
      Patient,
      Doctor,
      Study,
    ]),
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
