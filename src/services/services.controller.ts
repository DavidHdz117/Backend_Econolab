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
  Res,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { ServiceStatus } from './entities/service-order.entity';
import { Response } from 'express';

@UseGuards(AuthGuard('jwt'))
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  async create(@Body() dto: CreateServiceDto) {
    const service = await this.servicesService.create(dto);
    return {
      message: 'Servicio creado correctamente.',
      data: service,
    };
  }

  @Get()
  search(
    @Query('search') search?: string,
    @Query('status') status?: ServiceStatus,
    @Query('branchName') branchName?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.servicesService.search({
      search,
      status,
      branchName,
      fromDate,
      toDate,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.servicesService.findOne(id);
  }

  @Get(':id/receipt')
  async downloadReceipt(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.servicesService.generateReceiptPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="recibo-${id}.pdf"`,
    );
    res.send(buffer);
  }

  @Get(':id/labels')
  async downloadLabels(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.servicesService.generateTubeLabelsPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="etiquetas-${id}.pdf"`,
    );
    res.send(buffer);
  }

  @Get(':id/ticket')
  async downloadTicket(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.servicesService.generateTicketPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="ticket-${id}.pdf"`,
    );
    res.send(buffer);
  }

  @Get('folio/:folio')
  findByFolio(@Param('folio') folio: string) {
    return this.servicesService.findByFolio(folio);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceDto,
  ) {
    const service = await this.servicesService.update(id, dto);
    return {
      message: 'Servicio actualizado correctamente.',
      data: service,
    };
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceStatusDto,
  ) {
    const service = await this.servicesService.updateStatus(id, dto);
    return {
      message: 'Estatus de servicio actualizado correctamente.',
      data: service,
    };
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.servicesService.softDelete(id);
  }

  @Delete(':id/hard')
  hardRemove(@Param('id', ParseIntPipe) id: number) {
    return this.servicesService.hardDelete(id);
  }
}
