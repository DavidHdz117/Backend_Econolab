import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SyncOutboxFailureDto {
  @IsInt()
  @Min(1)
  id!: number;

  @IsString()
  @MaxLength(1000)
  error!: string;
}

export class FailSyncOutboxDto {
  @IsUUID()
  leaseToken!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncOutboxFailureDto)
  failures!: SyncOutboxFailureDto[];
}
