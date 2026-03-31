import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SyncMachineAuthGuard } from './guards/sync-machine-auth.guard';
import { ExportSyncBootstrapDto } from './dto/export-sync-bootstrap.dto';
import { PullSyncBootstrapDto } from './dto/pull-sync-bootstrap.dto';
import { RunSyncCycleDto } from './dto/run-sync-cycle.dto';
import { SyncBootstrapService } from './sync-bootstrap.service';
import { SyncRunnerService } from './sync-runner.service';

@UseGuards(SyncMachineAuthGuard)
@Controller('sync')
export class SyncManagementController {
  constructor(
    private readonly syncBootstrap: SyncBootstrapService,
    private readonly syncRunner: SyncRunnerService,
  ) {}

  @Get('status')
  getStatus() {
    return this.syncRunner.getStatus();
  }

  @Post('run')
  runOnce(@Body() dto: RunSyncCycleDto) {
    return this.syncRunner.runOnce({
      pushLimit: dto.pushLimit,
      pullLimit: dto.pullLimit,
      reason: 'manual',
    });
  }

  @Post('bootstrap/export')
  exportBootstrap(@Body() dto: ExportSyncBootstrapDto) {
    return this.syncBootstrap.exportResourcePage(dto.resourceType, {
      cursor: dto.cursor,
      limit: dto.limit,
      includeDeleted: dto.includeDeleted,
    });
  }

  @Post('bootstrap/pull')
  pullBootstrap(@Body() dto: PullSyncBootstrapDto) {
    return this.syncRunner.bootstrapFromRemote({
      resourceTypes: dto.resourceTypes,
      limit: dto.limit,
      includeDeleted: dto.includeDeleted,
    });
  }
}
