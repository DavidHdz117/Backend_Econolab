import { Injectable, NotFoundException, BadRequestException,} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {ServiceOrder, ServiceOrderItem, ServiceItemPriceType, ServiceStatus,} from './entities/service-order.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { Patient } from '../patients/entities/patient.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Study } from '../studies/entities/study.entity';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import * as bwipjs from 'bwip-js';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(ServiceOrder)
    private readonly serviceRepo: Repository<ServiceOrder>,
    @InjectRepository(ServiceOrderItem)
    private readonly itemRepo: Repository<ServiceOrderItem>,
    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,
    @InjectRepository(Doctor)
    private readonly doctorRepo: Repository<Doctor>,
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
  ) { }

  // --------- Helpers ---------

  private getPriceByType(study: Study, type: ServiceItemPriceType): number {
    switch (type) {
      case ServiceItemPriceType.DIF:
        return study.difPrice;
      case ServiceItemPriceType.SPECIAL:
        return study.specialPrice;
      case ServiceItemPriceType.HOSPITAL:
        return study.hospitalPrice;
      case ServiceItemPriceType.OTHER:
        return study.otherPrice;
      case ServiceItemPriceType.NORMAL:
      default:
        return study.normalPrice;
    }
  }

  private formatDate(value?: Date) {
    if (!value) return 'N/D';
    try {
      return new Date(value).toLocaleString('es-MX');
    } catch {
      return new Date(value).toISOString();
    }
  }

  private formatDateShort(value?: Date) {
    if (!value) return 'N/D';
    try {
      return new Date(value).toLocaleDateString('es-MX');
    } catch {
      return new Date(value).toISOString().slice(0, 10);
    }
  }

  private calcAge(birthDate?: string) {
    if (!birthDate) return 'N/D';
    const birth = new Date(birthDate);
    if (Number.isNaN(birth.getTime())) return 'N/D';
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age -= 1;
    }
    return `${age} años`;
  }

  private formatMoney(value: number) {
    if (Number.isNaN(value)) return '$0.00';
    return `$ ${value.toFixed(2)}`;
  }

  private mapPriceTypeLabel(type: ServiceItemPriceType) {
    switch (type) {
      case ServiceItemPriceType.DIF:
        return 'DIF';
      case ServiceItemPriceType.SPECIAL:
        return 'Especial';
      case ServiceItemPriceType.HOSPITAL:
        return 'Hospital';
      case ServiceItemPriceType.OTHER:
        return 'Otro';
      case ServiceItemPriceType.NORMAL:
      default:
        return 'Normal';
    }
  }

  private async buildBarcodeBuffer(text: string, height = 10) {
    try {
      return await bwipjs.toBuffer({
        bcid: 'code128',
        text,
        scale: 2,
        height,
        includetext: false,
      });
    } catch {
      return null;
    }
  }

  private truncate(text: string, max = 40) {
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  }

  private sanitizeBarcodeToken(text: string, max = 10) {
    if (!text) return 'NA';
    const cleaned = text
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, max);
    return cleaned || 'NA';
  }

  private async buildReceiptPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? 'ECONOLAB';
    const labSubtitle =
      process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
    const labAddress = process.env.LAB_ADDRESS ?? '';
    const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
    const labPhone = process.env.LAB_PHONE ?? '';
    const labEmail = process.env.LAB_EMAIL ?? '';
    const logoPath = process.env.LAB_LOGO_PATH ?? '';

    const patient = service.patient;
    const doctor = service.doctor;
    const barcodeText = service.folio ?? String(service.id);
    const barcodeBuffer = await this.buildBarcodeBuffer(barcodeText, 12);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const headerTop = doc.y;
      const logoBox = { x: 40, y: headerTop, w: 90, h: 50 };
      if (logoPath && fs.existsSync(logoPath)) {
        doc.image(logoPath, logoBox.x, logoBox.y, {
          fit: [logoBox.w, logoBox.h],
        });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(labName, 140, headerTop, { align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(labSubtitle, 140, headerTop + 14, { align: 'center' })
        .text(labAddress, 140, headerTop + 26, { align: 'center' })
        .text(labAddress2, 140, headerTop + 36, { align: 'center' });

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`FOLIO: ${service.folio ?? 'N/D'}`, 380, headerTop, {
          align: 'right',
        })
        .text(`SUC: ${service.branchName ?? 'N/D'}`, 380, headerTop + 12, {
          align: 'right',
        });

      if (barcodeBuffer) {
        doc.image(barcodeBuffer, 420, headerTop + 26, {
          width: 130,
          height: 32,
        });
      }

      doc.moveDown(3.2);
      doc
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.8);

      // Patient / Order info
      doc.font('Helvetica-Bold').fontSize(9).text('PACIENTE');
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(
          `Nombre: ${patient ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim() : 'N/D'}`,
        )
        .text(`Edad: ${this.calcAge(patient?.birthDate)}`)
        .text(`Sexo: ${patient?.gender ?? 'N/D'}`)
        .text(`Tel: ${patient?.phone ?? 'N/D'}`)
        .text(
          `Direccion: ${patient?.addressLine ?? 'N/D'}`,
        );

      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9).text('ORDEN');
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(`Fecha: ${this.formatDate(service.createdAt)}`)
        .text(`Toma de muestra: ${this.formatDate(service.sampleAt)}`)
        .text(`Entrega: ${this.formatDate(service.deliveryAt)}`)
        .text(`Doctor: ${doctor ? `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`.trim() : 'N/D'}`)
        .text(`Cedula: ${doctor?.licenseNumber ?? 'N/D'}`);

      doc.moveDown(0.8);
      doc
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.6);

      // Table header
      const colX = { name: 40, type: 300, price: 380, discount: 450, total: 510 };
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('ANALISIS CLINICO', colX.name, doc.y)
        .text('TP', colX.type, doc.y)
        .text('PRECIO', colX.price, doc.y)
        .text('DESC.', colX.discount, doc.y)
        .text('TOTAL', colX.total, doc.y);

      doc.moveDown(0.4);
      doc
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .strokeColor('#cccccc')
        .stroke();
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(9);
      for (const item of service.items ?? []) {
        const lineTotal = item.subtotalAmount ?? 0;
        doc.text(this.truncate(item.studyNameSnapshot ?? ''), colX.name, doc.y, {
          width: 240,
        });
        doc.text(this.mapPriceTypeLabel(item.priceType), colX.type, doc.y);
        doc.text(this.formatMoney(item.unitPrice ?? 0), colX.price, doc.y, {
          width: 60,
          align: 'right',
        });
        doc.text(`${item.discountPercent ?? 0} %`, colX.discount, doc.y, {
          width: 50,
          align: 'right',
        });
        doc.text(this.formatMoney(lineTotal), colX.total, doc.y, {
          width: 60,
          align: 'right',
        });
        doc.moveDown(0.6);
      }

      doc.moveDown(0.4);
      doc
        .moveTo(340, doc.y)
        .lineTo(555, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(9);
      const subtotal = service.subtotalAmount ?? 0;
      const courtesy = service.courtesyPercent ?? 0;
      const discount = service.discountAmount ?? 0;
      const total = service.totalAmount ?? 0;

      doc.text('SUBTOTAL:', 380, doc.y, { align: 'right' });
      doc.text(this.formatMoney(subtotal), 510, doc.y, { align: 'right' });
      doc.moveDown(0.4);
      doc.text('CORTESIA:', 380, doc.y, { align: 'right' });
      doc.text(`${courtesy} %`, 510, doc.y, { align: 'right' });
      doc.moveDown(0.4);
      doc.text('DESC. TOTAL:', 380, doc.y, { align: 'right' });
      doc.text(this.formatMoney(discount), 510, doc.y, { align: 'right' });
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').text('TOTAL:', 380, doc.y, { align: 'right' });
      doc.text(this.formatMoney(total), 510, doc.y, { align: 'right' });
      doc.font('Helvetica');

      doc.moveDown(1.2);
      if (labPhone || labEmail) {
        doc
          .fontSize(8)
          .text(`Tel: ${labPhone}`, 40, doc.y)
          .text(`Email: ${labEmail}`, 40, doc.y + 10);
      }

      doc.end();
    });
  }

  private async buildLabelsPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? 'ECONOLAB';
    const patient = service.patient;
    const sampleAt = service.sampleAt ?? service.createdAt;

    const studyIds = (service.items ?? []).map((item) => item.studyId);
    const studies = await this.studyRepo.findByIds(studyIds);
    const studyMap = new Map<number, Study>();
    studies.forEach((s) => studyMap.set(s.id, s));

    const labels: Array<{ item: ServiceOrderItem; barcode: string; studyCode: string }> = [];
    for (const item of service.items ?? []) {
      const study = studyMap.get(item.studyId);
      const studyCode = study?.code ?? String(item.studyId);
      const patientTag = this.sanitizeBarcodeToken(
        `${patient?.lastName ?? ''}${patient?.firstName ?? ''}`,
        8,
      );
      const studyTag = this.sanitizeBarcodeToken(
        study?.code ?? item.studyNameSnapshot ?? String(item.studyId),
        8,
      );
      const barcodeText = `${service.folio ?? service.id}-${patientTag}-${studyTag}-${item.id}`;
      labels.push({ item, barcode: barcodeText, studyCode });
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 24, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const labelWidth = 180;
      const labelHeight = 80;
      const gapX = 8;
      const gapY = 8;
      const startX = 24;
      const startY = 30;
      const cols = 3;
      const rowsPerPage = Math.floor(
        (pageHeight - startY * 2 + gapY) / (labelHeight + gapY),
      );

      let index = 0;

      const drawLabel = async (x: number, y: number, item: ServiceOrderItem, barcodeText: string, studyCode: string) => {
        doc
          .rect(x, y, labelWidth, labelHeight)
          .strokeColor('#dddddd')
          .stroke();

        const patientName = patient
          ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim()
          : 'N/D';
        const gender = patient?.gender ?? 'N/D';
        const age = this.calcAge(patient?.birthDate);

        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(labName, x + 4, y + 4, { width: labelWidth - 8 });

        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(this.truncate(patientName, 28), x + 4, y + 14, {
            width: labelWidth - 8,
          });

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(`Sexo: ${gender}  Edad: ${age}`, x + 4, y + 24, {
            width: labelWidth - 8,
          });

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(
            `Estudio: ${this.truncate(item.studyNameSnapshot ?? studyCode, 26)}`,
            x + 4,
            y + 34,
            { width: labelWidth - 8 },
          );

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(`Folio: ${service.folio ?? service.id}`, x + 4, y + 44, {
            width: labelWidth - 8,
          })
          .text(`Muestra: ${this.formatDateShort(sampleAt)}`, x + 4, y + 54, {
            width: labelWidth - 8,
          });

        const barcodeBuffer = await this.buildBarcodeBuffer(barcodeText, 8);
        if (barcodeBuffer) {
          doc.image(barcodeBuffer, x + 6, y + 62, {
            width: labelWidth - 12,
            height: 14,
          });
        }

        doc
          .font('Helvetica')
          .fontSize(6)
          .text(barcodeText, x + 6, y + 76, {
            width: labelWidth - 12,
            align: 'center',
          });
      };

      const renderLabels = async () => {
        for (const label of labels) {
          const pageIndex = Math.floor(index / (cols * rowsPerPage));
          if (index > 0 && index % (cols * rowsPerPage) === 0) {
            doc.addPage();
          }

          const localIndex = index % (cols * rowsPerPage);
          const row = Math.floor(localIndex / cols);
          const col = localIndex % cols;

          const x = startX + col * (labelWidth + gapX);
          const y = startY + row * (labelHeight + gapY);

          await drawLabel(x, y, label.item, label.barcode, label.studyCode);
          index += 1;
        }
      };

      renderLabels()
        .then(() => {
          doc.end();
        })
        .catch((err) => reject(err));
    });
  }

  // --------- CRUD principal ---------

  async create(dto: CreateServiceDto) {
    const patient = await this.patientRepo.findOne({
      where: { id: dto.patientId, isActive: true },
    });
    if (!patient) {
      throw new NotFoundException('El paciente no existe o está inactivo.');
    }

    let doctor: Doctor | null = null;
    if (dto.doctorId) {
      doctor = await this.doctorRepo.findOne({
        where: { id: dto.doctorId, isActive: true },
      });
      if (!doctor) {
        throw new NotFoundException('El médico no existe o está inactivo.');
      }
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'Debe agregar al menos un análisis al servicio.',
      );
    }

    // Cargamos todos los estudios involucrados
    const studyIds = dto.items.map((i) => i.studyId);
    const studies = await this.studyRepo.findByIds(studyIds);
    if (studies.length !== studyIds.length) {
      throw new NotFoundException(
        'Uno o más estudios no existen o están inactivos.',
      );
    }

    const studyMap = new Map<number, Study>();
    studies.forEach((s) => studyMap.set(s.id, s));

    const items: ServiceOrderItem[] = [];

    let subtotal = 0;

    for (const itemDto of dto.items) {
      const study = studyMap.get(itemDto.studyId)!;
      const unitPrice = this.getPriceByType(study, itemDto.priceType);
      const quantity = itemDto.quantity;
      const itemDiscount = itemDto.discountPercent ?? 0;

      const lineBase = unitPrice * quantity;
      const lineSubtotal = lineBase * (1 - itemDiscount / 100);

      subtotal += lineSubtotal;

      const item = this.itemRepo.create({
        studyId: study.id,
        studyNameSnapshot: study.name,
        priceType: itemDto.priceType,
        unitPrice,
        quantity,
        discountPercent: itemDiscount,
        subtotalAmount: lineSubtotal,
      });

      items.push(item);
    }

    const courtesyPercent = dto.courtesyPercent ?? 0;
    const discountAmount = subtotal * (courtesyPercent / 100);
    const total = subtotal - discountAmount;

    const service = this.serviceRepo.create({
      folio: dto.folio,
      patientId: dto.patientId,
      doctorId: dto.doctorId,
      branchName: dto.branchName,
      sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : undefined,
      deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : undefined,
      status: dto.status ?? ServiceStatus.PENDING,
      courtesyPercent,
      subtotalAmount: subtotal,
      discountAmount,
      totalAmount: total,
      notes: dto.notes,
      items,
    });

    return this.serviceRepo.save(service);
  }

  async findOne(id: number) {
    const service = await this.serviceRepo.findOne({
      where: { id, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('Servicio no encontrado.');
    }
    return service;
  }

  async findByFolio(folio: string) {
    const service = await this.serviceRepo.findOne({
      where: { folio, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('Servicio no encontrado.');
    }
    return service;
  }

  /**
   * Búsqueda paginada de servicios
   * Filtros: texto (folio, nombre paciente), estatus y rango de fechas de creación.
   */
  async search(params: {
    search?: string;
    status?: ServiceStatus;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, fromDate, toDate } = params;
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 10;

    const qb = this.serviceRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.patient', 'p')
      .leftJoinAndSelect('s.doctor', 'd')
      .leftJoinAndSelect('s.items', 'i')
      .where('s.isActive = :active', { active: true });

    if (status) {
      qb.andWhere('s.status = :status', { status });
    }

    if (fromDate && toDate) {
      qb.andWhere('s.createdAt BETWEEN :from AND :to', {
        from: new Date(fromDate),
        to: new Date(toDate),
      });
    }

    if (search) {
      qb.andWhere(
        '(s.folio LIKE :q OR p.firstName LIKE :q OR p.lastName LIKE :q)',
        { q: `%${search}%` },
      );
    }

    qb.orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  async update(id: number, dto: UpdateServiceDto) {
    const service = await this.findOne(id);

    // Por simplicidad, aquí no recalculamos todos los ítems.
    // Si quieres soportar edición completa (cambiar estudios, etc.)
    // podemos hacer una función similar a create que reemplace items.
    if (dto.patientId && dto.patientId !== service.patientId) {
      const patient = await this.patientRepo.findOne({
        where: { id: dto.patientId, isActive: true },
      });
      if (!patient) {
        throw new NotFoundException('El nuevo paciente no existe o está inactivo.');
      }
    }

    if (dto.doctorId && dto.doctorId !== service.doctorId) {
      const doctor = await this.doctorRepo.findOne({
        where: { id: dto.doctorId, isActive: true },
      });
      if (!doctor) {
        throw new NotFoundException('El nuevo médico no existe o está inactivo.');
      }
    }

    const merged = this.serviceRepo.merge(service, {
      folio: dto.folio ?? service.folio,
      patientId: dto.patientId ?? service.patientId,
      doctorId: dto.doctorId ?? service.doctorId,
      branchName: dto.branchName ?? service.branchName,
      sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : service.sampleAt,
      deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : service.deliveryAt,
      status: dto.status ?? service.status,
      courtesyPercent: dto.courtesyPercent ?? service.courtesyPercent,
      notes: dto.notes ?? service.notes,
      // Totales: podrías recalcular aquí si cambias cortesía
    });

    // Si solo cambió cortesía, ajustamos totales sin tocar los ítems
    if (dto.courtesyPercent !== undefined) {
      const subtotal = merged.subtotalAmount;
      const discount = subtotal * (merged.courtesyPercent / 100);
      merged.discountAmount = discount;
      merged.totalAmount = subtotal - discount;
    }

    return this.serviceRepo.save(merged);
  }

  async updateStatus(id: number, dto: UpdateServiceStatusDto) {
    const service = await this.findOne(id);
    service.status = dto.status;
    return this.serviceRepo.save(service);
  }

  async softDelete(id: number) {
    const service = await this.findOne(id);
    service.isActive = false;
    await this.serviceRepo.save(service);
    return { message: 'Servicio desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const result = await this.serviceRepo.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Servicio no encontrado.');
    }
    return { message: 'Servicio eliminado definitivamente.' };
  }

  async generateReceiptPdf(id: number) {
    const service = await this.findOne(id);
    return this.buildReceiptPdfBuffer(service);
  }

  async generateTubeLabelsPdf(id: number) {
    const service = await this.findOne(id);
    return this.buildLabelsPdfBuffer(service);
  }
}
