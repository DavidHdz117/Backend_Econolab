import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApplySyncMutationsDto } from './dto/apply-sync-mutations.dto';
import { ClaimSyncOutboxDto } from './dto/claim-sync-outbox.dto';
import { FailSyncOutboxDto } from './dto/fail-sync-outbox.dto';
import { LeaseSyncOutboxDto } from './dto/lease-sync-outbox.dto';
import { RequeueSyncOutboxDto } from './dto/requeue-sync-outbox.dto';
import { SyncMachineAuthGuard } from './guards/sync-machine-auth.guard';
import { SyncInboundService } from './sync-inbound.service';
import { SyncOutboxService } from './sync-outbox.service';

@UseGuards(SyncMachineAuthGuard)
@Controller('sync/outbox')
export class SyncController {
  constructor(
    private readonly syncOutbox: SyncOutboxService,
    private readonly syncInbound: SyncInboundService,
  ) {}

  @Get('summary')
  getSummary() {
    return this.syncOutbox.getSummary();
  }

  @Post('claim')
  async claim(@Body() dto: ClaimSyncOutboxDto) {
    const claimed = await this.syncOutbox.claimPendingBatch(dto.limit);

    return {
      leaseToken: claimed.leaseToken,
      count: claimed.events.length,
      events: claimed.events,
    };
  }

  @Post('ack')
  async ack(@Body() dto: LeaseSyncOutboxDto) {
    const result = await this.syncOutbox.markAsSynced(dto.leaseToken, dto.ids);

    return {
      message: 'Eventos marcados como sincronizados.',
      affected: result.affected,
    };
  }

  @Post('fail')
  async fail(@Body() dto: FailSyncOutboxDto) {
    const result = await this.syncOutbox.failBatch(dto.leaseToken, dto.failures);

    return {
      message: 'Eventos marcados como fallidos.',
      affected: result.affected,
    };
  }

  @Post('requeue')
  async requeue(@Body() dto: RequeueSyncOutboxDto) {
    const result = await this.syncOutbox.requeue(
      dto.ids,
      dto.includeProcessing ?? false,
    );

    return {
      message: 'Eventos reencolados correctamente.',
      affected: result.affected,
    };
  }

  @Post('inbound/apply')
  applyInbound(@Body() dto: ApplySyncMutationsDto) {
    return this.syncInbound.applyBatch(dto.mutations);
  }
}
