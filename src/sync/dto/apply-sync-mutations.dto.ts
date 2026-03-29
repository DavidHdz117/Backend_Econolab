import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsObject,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SyncOutboxOperation } from '../entities/sync-outbox-event.entity';

class SyncInboundMutationDto {
  @IsString()
  @MaxLength(120)
  resourceType!: string;

  @IsEnum(SyncOutboxOperation)
  operation!: SyncOutboxOperation;

  @IsObject()
  payload!: Record<string, unknown>;
}

export class ApplySyncMutationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncInboundMutationDto)
  mutations!: SyncInboundMutationDto[];
}

export type SyncInboundMutationInput = {
  resourceType: string;
  operation: SyncOutboxOperation;
  payload: Record<string, unknown>;
};
