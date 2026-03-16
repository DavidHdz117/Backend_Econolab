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
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorStatusDto } from './dto/update-doctor-status.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { DoctorsService } from './doctors.service';

@UseGuards(AuthGuard('jwt'))
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Get()
  search(
    @Query('search') search = '',
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('status') status?: string,
  ) {
    return this.doctorsService.search(search, +page, +limit, status);
  }

  @Get('exists')
  exists(@Query('licenseNumber') licenseNumber: string) {
    return this.doctorsService.existsByLicense(licenseNumber);
  }

  @Post()
  async create(@Body() dto: CreateDoctorDto) {
    const doctor = await this.doctorsService.create(dto);
    return {
      message: 'Medico creado correctamente.',
      data: doctor,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.doctorsService.findOne(+id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDoctorDto) {
    const doctor = await this.doctorsService.update(+id, dto);
    return {
      message: 'Medico actualizado correctamente.',
      data: doctor,
    };
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDoctorStatusDto,
  ) {
    const doctor = await this.doctorsService.updateStatus(+id, dto);
    return {
      message: dto.isActive
        ? 'Medico activado correctamente.'
        : 'Medico desactivado correctamente.',
      data: doctor,
    };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.doctorsService.softDelete(+id);
  }

  @Delete(':id/hard')
  hardRemove(@Param('id') id: string) {
    return this.doctorsService.hardDelete(+id);
  }
}
