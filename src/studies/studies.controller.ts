import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { StudiesService } from './studies.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { CreateStudyDetailDto } from './dto/create-study-detail.dto';
import { UpdateStudyDetailDto } from './dto/update-study-detail.dto';
import { UpdateStudyDetailStatusDto } from './dto/update-study-detail-status.dto';
import { StudyStatus, StudyType } from './entities/study.entity';

@UseGuards(AuthGuard('jwt'))
@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Get()
  search(
    @Query('search') search = '',
    @Query('type') type?: StudyType,
    @Query('status') status?: StudyStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.studiesService.search(search, type, status, +page, +limit);
  }

  @Get('exists')
  exists(@Query('code') code: string) {
    return this.studiesService.existsByCode(code);
  }

  @Post()
  async create(@Body() dto: CreateStudyDto) {
    const study = await this.studiesService.create(dto);
    return {
      message: 'Estudio creado correctamente.',
      data: study,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.studiesService.findOne(+id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateStudyDto) {
    const study = await this.studiesService.update(+id, dto);
    return {
      message: 'Estudio actualizado correctamente.',
      data: study,
    };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.studiesService.softDelete(+id);
  }

  @Delete(':id/hard')
  hardRemove(@Param('id') id: string) {
    return this.studiesService.hardDelete(+id);
  }

  // -------- DETALLES --------

  @Get(':id/details')
  listDetails(@Param('id') id: string) {
    return this.studiesService.listDetails(+id);
  }

  @Post(':id/details')
  async createDetail(
    @Param('id') id: string,
    @Body() dto: CreateStudyDetailDto,
  ) {
    const detail = await this.studiesService.createDetail(+id, dto);
    return {
      message: 'Detalle de estudio creado correctamente.',
      data: detail,
    };
  }

  @Put('details/:detailId')
  async updateDetail(
    @Param('detailId') detailId: string,
    @Body() dto: UpdateStudyDetailDto,
  ) {
    const detail = await this.studiesService.updateDetail(+detailId, dto);
    return {
      message: 'Detalle de estudio actualizado correctamente.',
      data: detail,
    };
  }

  @Put('details/:detailId/status')
  async updateDetailStatus(
    @Param('detailId') detailId: string,
    @Body() dto: UpdateStudyDetailStatusDto,
  ) {
    const detail = await this.studiesService.updateDetailStatus(+detailId, dto);
    return {
      message: dto.isActive
        ? 'Detalle de estudio activado correctamente.'
        : 'Detalle de estudio suspendido correctamente.',
      data: detail,
    };
  }

  @Delete('details/:detailId')
  removeDetail(@Param('detailId') detailId: string) {
    return this.studiesService.softDeleteDetail(+detailId);
  }

  @Delete('details/:detailId/hard')
  hardRemoveDetail(@Param('detailId') detailId: string) {
    return this.studiesService.hardDeleteDetail(+detailId);
  }
}
