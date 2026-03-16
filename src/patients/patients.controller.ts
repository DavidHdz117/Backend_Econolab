import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientStatusDto } from './dto/update-patient-status.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientsService } from './patients.service';

@UseGuards(AuthGuard('jwt'))
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  search(
    @Query('search') search = '',
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('status') status?: string,
  ) {
    return this.patientsService.search(search, +page, +limit, status);
  }

  @Get('exists')
  exists(
    @Query('documentType') documentType: string,
    @Query('documentNumber') documentNumber: string,
  ) {
    return this.patientsService.existsByDocument(documentType, documentNumber);
  }

  @Post()
  async create(@Body() dto: CreatePatientDto) {
    const patient = await this.patientsService.create(dto);
    return {
      message: 'Paciente creado correctamente.',
      data: patient,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(+id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    const patient = await this.patientsService.update(+id, dto);
    return {
      message: 'Paciente actualizado correctamente.',
      data: patient,
    };
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePatientStatusDto,
  ) {
    const patient = await this.patientsService.updateStatus(+id, dto);
    return {
      message: dto.isActive
        ? 'Paciente activado correctamente.'
        : 'Paciente desactivado correctamente.',
      data: patient,
    };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.patientsService.softDelete(+id);
  }
}
