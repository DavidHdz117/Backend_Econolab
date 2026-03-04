import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { DbAdminService } from './db-admin.service';
import { GenerateBackupDto } from './dto/generate-backup.dto';
import type { Response } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('db-admin')
export class DbAdminController {
  constructor(private readonly dbAdminService: DbAdminService) {}

  @Post('backups')
  async backups(@Body() dto: GenerateBackupDto, @Res() res: Response) {
    const file = await this.dbAdminService.generateBackup(dto);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return res.send(file.content);
  }

  @Get('topics')
  topics() {
    return this.dbAdminService.topics();
  }

  @Get('health')
  health() {
    return this.dbAdminService.health();
  }

  @Get('overview')
  overview() {
    return this.dbAdminService.overview();
  }

  @Get('tables')
  tables() {
    return this.dbAdminService.tables();
  }

  @Get('backup-restore')
  backupRestore() {
    return this.dbAdminService.backupRestore();
  }

  @Get('automation')
  automation() {
    return this.dbAdminService.automation();
  }

  @Get('export-import')
  exportImport() {
    return this.dbAdminService.exportImport();
  }

  @Get('security')
  security() {
    return this.dbAdminService.security();
  }

  @Get('performance')
  performance() {
    return this.dbAdminService.performance();
  }
}
