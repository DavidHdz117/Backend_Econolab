import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type DatabaseRuntimeConfig,
  type SupportedDatabaseType,
} from '../config/database.config';
import {
  buildCompactSearchSqlExpression,
  buildDigitsOnlySqlExpression,
  buildLowerTrimSqlExpression,
} from '../common/utils/search-normalization.util';
import {
  getLocalDateExpression,
  getLocalDateTokenExpression,
} from '../common/utils/lab-date.util';

@Injectable()
export class DatabaseDialectService {
  constructor(private readonly configService: ConfigService) {}

  get type(): SupportedDatabaseType {
    return this.configService.getOrThrow<DatabaseRuntimeConfig>('database').type;
  }

  buildCompactSearchExpression(expression: string) {
    return buildCompactSearchSqlExpression(expression, this.type);
  }

  buildDigitsOnlyExpression(expression: string) {
    return buildDigitsOnlySqlExpression(expression, this.type);
  }

  buildLowerTrimExpression(expression: string) {
    return buildLowerTrimSqlExpression(expression, this.type);
  }

  getLocalDateExpression(timeZone: string, expression: string) {
    return getLocalDateExpression(timeZone, expression, this.type);
  }

  getDateTokenExpression(timeZone: string, expression: string) {
    return getLocalDateTokenExpression(timeZone, expression, this.type);
  }
}
