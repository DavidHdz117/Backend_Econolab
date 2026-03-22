import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/roles.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import { HistoryService } from './history.service';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.Admin)
@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('dashboard')
  getDashboard(
    @Query('date') date?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.historyService.getDashboard(date, search, fromDate, toDate);
  }

  @Post('daily-cuts')
  generateDailyCut(@Body('date') date?: string) {
    return this.historyService.generateDailyCut(date);
  }

  @Get('daily-cuts/overview')
  getDailyCutsOverview(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.historyService.getDailyCutsOverview(fromDate, toDate);
  }

  @Get('daily-cuts/:id')
  getDailyCutById(@Param('id') id: string) {
    return this.historyService.getDailyCutById(+id);
  }

  @Delete('daily-cuts/:id')
  deleteDailyCut(@Param('id') id: string) {
    return this.historyService.deleteDailyCut(+id);
  }

  @Get('daily-cuts/:id/export')
  async exportDailyCut(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.historyService.exportDailyCutCsv(+id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="corte-dia-${id}.csv"`,
    );
    res.send(buffer);
  }
}
