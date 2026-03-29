import { Global, Module } from '@nestjs/common';
import { DatabaseDialectService } from './database-dialect.service';

@Global()
@Module({
  providers: [DatabaseDialectService],
  exports: [DatabaseDialectService],
})
export class DatabaseModule {}
