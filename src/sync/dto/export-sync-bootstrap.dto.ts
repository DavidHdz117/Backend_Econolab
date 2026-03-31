import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SUPPORTED_INBOUND_SYNC_RESOURCES,
  type SupportedInboundSyncResourceType,
} from '../sync-resource.util';

export class ExportSyncBootstrapDto {
  @IsIn(SUPPORTED_INBOUND_SYNC_RESOURCES)
  resourceType!: SupportedInboundSyncResourceType;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;

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
