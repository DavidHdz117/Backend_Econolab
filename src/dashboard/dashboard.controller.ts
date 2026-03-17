import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/roles.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.Admin)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  getOverview(
    @Query('range') range?: string,
    @Query('role') role?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getOverview(range, role, startDate, endDate);
  }
}
