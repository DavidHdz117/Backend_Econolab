import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { SUPPORTED_INBOUND_SYNC_RESOURCES } from '../sync-resource.util';

export class PullSyncBootstrapDto {
  @IsOptional()
  @IsArray()
  @IsIn(SUPPORTED_INBOUND_SYNC_RESOURCES, { each: true })
  resourceTypes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeDeleted?: boolean;
}
