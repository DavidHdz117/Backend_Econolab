import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncOutboxEvent } from './entities/sync-outbox-event.entity';
import { SyncMachineAuthGuard } from './guards/sync-machine-auth.guard';
import { SyncInboundService } from './sync-inbound.service';
import { SyncController } from './sync.controller';
import { SyncOutboxService } from './sync-outbox.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SyncOutboxEvent])],
  providers: [SyncOutboxService, SyncInboundService, SyncMachineAuthGuard],
  controllers: [SyncController],
  exports: [SyncOutboxService, SyncInboundService],
})
export class SyncModule {}
