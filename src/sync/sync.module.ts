import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncOutboxEvent } from './entities/sync-outbox-event.entity';
import { SyncMachineAuthGuard } from './guards/sync-machine-auth.guard';
import { SyncManagementController } from './sync-management.controller';
import { SyncBootstrapService } from './sync-bootstrap.service';
import { SyncInboundService } from './sync-inbound.service';
import { SyncController } from './sync.controller';
import { SyncOutboxService } from './sync-outbox.service';
import { SyncRemoteClientService } from './sync-remote-client.service';
import { SyncRunnerService } from './sync-runner.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SyncOutboxEvent])],
  providers: [
    SyncOutboxService,
    SyncInboundService,
    SyncMachineAuthGuard,
    SyncBootstrapService,
    SyncRemoteClientService,
    SyncRunnerService,
  ],
  controllers: [SyncController, SyncManagementController],
  exports: [
    SyncOutboxService,
    SyncInboundService,
    SyncBootstrapService,
    SyncRunnerService,
  ],
})
export class SyncModule {}
