import { IsEnum } from 'class-validator';
import { ServiceStatus } from '../entities/service-order.entity';

export class UpdateServiceStatusDto {
  @IsEnum(ServiceStatus, {
    message:
      'El estatus es inválido. Valores permitidos: pending, in_progress, delayed, completed, cancelled.',
  })
  status: ServiceStatus;
}
