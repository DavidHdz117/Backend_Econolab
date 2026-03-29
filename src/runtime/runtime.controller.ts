import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/roles.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import { RuntimeDiagnosticsService } from './runtime-diagnostics.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('runtime')
export class RuntimeController {
  constructor(
    private readonly runtimeDiagnostics: RuntimeDiagnosticsService,
  ) {}

  @Get('diagnostics')
  getDiagnostics() {
    return this.runtimeDiagnostics.getDiagnostics();
  }
}
