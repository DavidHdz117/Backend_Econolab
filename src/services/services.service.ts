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
import PDFDocument = require('pdfkit');
import * as fs from 'fs';
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

  private toNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getPriceByType(study: Study, type: ServiceItemPriceType): number {
    switch (type) {
      case ServiceItemPriceType.DIF:
        return this.toNumber(study.difPrice);
      case ServiceItemPriceType.SPECIAL:
        return this.toNumber(study.specialPrice);
      case ServiceItemPriceType.HOSPITAL:
        return this.toNumber(study.hospitalPrice);
      case ServiceItemPriceType.OTHER:
        return this.toNumber(study.otherPrice);
      case ServiceItemPriceType.NORMAL:
      default:
        return this.toNumber(study.normalPrice);
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

  private formatMoney(value: unknown) {
    const amount = this.toNumber(value);
    return `$ ${amount.toFixed(2)}`;
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
    const patientName = patient
      ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim()
      : '';
    const doctorName = doctor
      ? `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`.trim()
      : '';
    const genderMap: Record<string, string> = {
      male: 'Masculino',
      female: 'Femenino',
      other: 'Otro',
    };
    const genderLabel = patient?.gender ? genderMap[patient.gender] ?? patient.gender : '';

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      const drawImageIfValid = (
        imagePath: string,
        x: number,
        y: number,
        options: Record<string, unknown>,
      ) => {
        if (!imagePath || !fs.existsSync(imagePath)) return false;
        try {
          doc.image(imagePath, x, y, options);
          return true;
        } catch {
          return false;
        }
      };

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const left = 40;
      const right = 555;
      const headerY = 42;

      const hasLogo = drawImageIfValid(logoPath, left, headerY + 6, {
        fit: [95, 52],
      });
      if (!hasLogo) {
        doc.rect(left, headerY + 6, 95, 52).strokeColor('#cccccc').stroke();
        doc.font('Helvetica').fontSize(8).fillColor('#666666').text('LOGO', left, headerY + 26, {
          width: 95,
          align: 'center',
        }).fillColor('black');
      }

      doc.font('Helvetica-Bold').fontSize(15).text(labName, 150, headerY, { width: 265, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8.5).text(labSubtitle, 150, headerY + 18, { width: 265, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8.5).text(labAddress, 150, headerY + 30, { width: 265, align: 'center' });
      if (labAddress2) {
        doc.font('Helvetica-Bold').fontSize(8.5).text(labAddress2, 150, headerY + 42, { width: 265, align: 'center' });
      }
      if (labPhone) {
        doc.font('Helvetica-Bold').fontSize(8.5).text(`TELEFONO ${labPhone}`, 150, headerY + 54, { width: 265, align: 'center' });
      }

      doc.font('Helvetica-Bold').fontSize(12).text('FOLIO', 440, headerY + 4, { width: 115, align: 'right' });
      doc.text(service.folio ?? '', 440, headerY + 24, { width: 115, align: 'right' });

      if (barcodeBuffer) {
        doc.image(barcodeBuffer, 405, headerY + 48, { width: 150, height: 36 });
        doc.font('Helvetica').fontSize(8).text(barcodeText, 405, headerY + 86, { width: 150, align: 'center' });
      }

      doc.moveTo(left, 158).lineTo(right, 158).strokeColor('#999999').stroke();

      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(`PACIENTE: ${patientName}`, left, 170, { width: 260 });
      doc.text(`TEL:${patient?.phone ?? ''}`, left, 186, { width: 260 });
      doc.text(`DIRECCION: ${patient?.addressLine ?? ''}`, left, 202, { width: 260 });
      doc.text(`ENTRE CALLES: ${patient?.addressBetween ?? ''}`, left, 218, { width: 260 });

      doc.text(`FECHA: ${this.formatDate(service.createdAt)}`, 280, 170, { width: 165 });
      doc.text(`EDAD: ${this.calcAge(patient?.birthDate)}`, 280, 186, { width: 165 });
      doc.text(`SEXO: ${genderLabel}`, 280, 202, { width: 165 });
      doc.text(`FECHA DE ENTREGA: ${this.formatDate(service.deliveryAt)}`, 280, 218, { width: 220 });

      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(`SUC: ${service.branchName ?? ''}`, 440, 186, { width: 115, align: 'left' });
      doc.text(`FOLIO: ${service.folio ?? ''}`, 440, 204, { width: 115, align: 'left' });

      doc.moveTo(left, 238).lineTo(right, 238).strokeColor('#999999').stroke();

      const colX = { name: left + 8, type: 250, price: 335, discount: 420, total: 500 };
      const tableY = 248;
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('ANALISIS CLINICO', colX.name, tableY, { width: 210 })
        .text('TP', colX.type, tableY, { width: 40 })
        .text('PRECIO', colX.price, tableY, { width: 80, align: 'center' })
        .text('DESC.', colX.discount, tableY, { width: 60, align: 'center' })
        .text('TOTAL', colX.total, tableY, { width: 55, align: 'right' });

      doc.moveTo(left + 8, tableY + 22).lineTo(right, tableY + 22).strokeColor('#999999').stroke();

      let rowY = tableY + 32;
      doc.font('Helvetica').fontSize(10);
      for (const item of service.items ?? []) {
        const lineTotal = this.toNumber(item.subtotalAmount);
        const unitPrice = this.toNumber(item.unitPrice);
        const itemDiscount = this.toNumber(item.discountPercent);

        doc.text(this.truncate(item.studyNameSnapshot ?? '', 40), colX.name, rowY, { width: 210 });
        doc.fontSize(8).text(`DESCRIPCION: ${this.truncate(item.studyNameSnapshot ?? '', 42)}`, colX.name, rowY + 12, { width: 210 });
        doc.fontSize(10).text(this.mapPriceTypeLabel(item.priceType), colX.type, rowY + 4, { width: 40 });
        doc.text(this.formatMoney(unitPrice), colX.price, rowY + 4, { width: 80, align: 'right' });
        doc.text(`${itemDiscount} %`, colX.discount, rowY + 4, { width: 60, align: 'right' });
        doc.text(this.formatMoney(lineTotal), colX.total, rowY + 4, { width: 55, align: 'right' });
        rowY += 34;
      }

      doc.font('Helvetica').fontSize(9);
      const subtotal = this.toNumber(service.subtotalAmount);
      const courtesy = this.toNumber(service.courtesyPercent);
      const discount = this.toNumber(service.discountAmount);
      const total = this.toNumber(service.totalAmount);

      let totalsY = Math.max(rowY + 20, 400);
      doc.moveTo(350, totalsY - 6).lineTo(right, totalsY - 6).strokeColor('#999999').stroke();
      doc.text('SUBTOTAL:', 430, totalsY, { width: 70, align: 'right' });
      doc.text(this.formatMoney(subtotal), 500, totalsY, { width: 55, align: 'right' });
      totalsY += 16;
      doc.text('CORTESIA:', 430, totalsY, { width: 70, align: 'right' });
      doc.text(`${courtesy} %`, 500, totalsY, { width: 55, align: 'right' });
      totalsY += 16;
      doc.text('DESC. TOTAL:', 430, totalsY, { width: 70, align: 'right' });
      doc.text(this.formatMoney(discount), 500, totalsY, { width: 55, align: 'right' });
      totalsY += 16;
      doc.font('Helvetica-Bold').text('TOTAL:', 430, totalsY, { width: 70, align: 'right' });
      doc.text(this.formatMoney(total), 500, totalsY, { width: 55, align: 'right' });
      doc.font('Helvetica');

      if (labPhone) doc.fontSize(8).text(`Tel: ${labPhone}`, left, 700);
      if (labEmail) doc.text(`Email: ${labEmail}`, left, 712);

      doc.end();
    });
  }

  private async buildTicketPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? 'ECONOLAB';
    const labSubtitle =
      process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
    const labAddress = process.env.LAB_ADDRESS ?? '';
    const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
    const labPhone = process.env.LAB_PHONE ?? '';
    const logoPath = process.env.LAB_LOGO_PATH ?? '';
    const patient = service.patient;

    const patientName = patient
      ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim()
      : '';
    const genderMap: Record<string, string> = {
      male: 'Masculino',
      female: 'Femenino',
      other: 'Otro',
    };
    const genderLabel = patient?.gender ? genderMap[patient.gender] ?? patient.gender : '';
    const ticketWidth = 226.77; // 80mm

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 14, size: [ticketWidth, 700] });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      if (logoPath && fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, (ticketWidth - 86) / 2, 16, { fit: [86, 42] });
        } catch {
          // ignore image errors for ticket
        }
      }

      doc.font('Helvetica-Bold').fontSize(6.5).text(labName, 14, 66, { width: ticketWidth - 28, align: 'center' });
      doc.fontSize(6).text(labSubtitle, 14, 76, { width: ticketWidth - 28, align: 'center' });
      doc.text(labAddress, 14, 85, { width: ticketWidth - 28, align: 'center' });
      if (labAddress2) doc.text(labAddress2, 14, 93, { width: ticketWidth - 28, align: 'center' });
      if (labPhone) doc.text(`TEL. ${labPhone}`, 14, 101, { width: ticketWidth - 28, align: 'center' });

      let y = 116;
      doc.fontSize(6.8).text(`FOLIO ${service.folio ?? ''}`, 14, y);
      doc.text(`SUC: ${service.branchName ?? ''}`, 124, y, { width: 88, align: 'right' });
      y += 10;
      doc.text(`FECHA: ${this.formatDate(service.createdAt)}`, 14, y);
      y += 10;
      doc.text(`PACIENTE: ${this.truncate(patientName, 26)}`, 14, y);
      y += 10;
      doc.text(`EDAD: ${this.calcAge(patient?.birthDate)}`, 14, y);
      y += 10;
      doc.text(`TEL: ${patient?.phone ?? ''}`, 14, y);
      y += 10;
      doc.text(`DIRECCION: ${this.truncate(patient?.addressLine ?? '', 26)}`, 14, y);
      y += 10;
      doc.text(`ENTRE CALLES: ${this.truncate(patient?.addressBetween ?? '', 24)}`, 14, y);
      y += 10;
      doc.text(`SEXO: ${genderLabel}`, 124, y - 20, { width: 88, align: 'left' });
      doc.text(`FECHA DE ENTREGA: ${this.formatDate(service.deliveryAt)}`, 14, y);
      y += 12;

      doc.moveTo(14, y).lineTo(ticketWidth - 14, y).strokeColor('#999999').stroke();
      y += 6;

      doc.font('Helvetica-Bold').fontSize(6.8);
      doc.text('ANALISIS CLINICO', 14, y, { width: 90 });
      doc.text('TP', 108, y, { width: 20 });
      doc.text('PRECIO', 126, y, { width: 34, align: 'right' });
      doc.text('DESC.', 160, y, { width: 24, align: 'right' });
      doc.text('TOTAL', 186, y, { width: 26, align: 'right' });
      y += 8;
      doc.moveTo(14, y).lineTo(ticketWidth - 14, y).strokeColor('#999999').stroke();
      y += 4;

      doc.font('Helvetica').fontSize(6.6);
      for (const item of service.items ?? []) {
        const lineTotal = this.toNumber(item.subtotalAmount);
        const unitPrice = this.toNumber(item.unitPrice);
        const itemDiscount = this.toNumber(item.discountPercent);
        doc.text(this.truncate(item.studyNameSnapshot ?? '', 24), 14, y, { width: 92 });
        doc.text(this.mapPriceTypeLabel(item.priceType), 108, y, { width: 20 });
        doc.text(this.formatMoney(unitPrice), 126, y, { width: 34, align: 'right' });
        doc.text(`${itemDiscount} %`, 160, y, { width: 24, align: 'right' });
        doc.text(this.formatMoney(lineTotal), 186, y, { width: 26, align: 'right' });
        y += 8;
        doc.fontSize(5.8).fillColor('#555555').text(`DESCRIPCION: ${this.truncate(item.studyNameSnapshot ?? '', 26)}`, 20, y, { width: 84 });
        doc.fontSize(6.6).fillColor('black');
        y += 10;
      }

      const subtotal = this.toNumber(service.subtotalAmount);
      const courtesy = this.toNumber(service.courtesyPercent);
      const discount = this.toNumber(service.discountAmount);
      const total = this.toNumber(service.totalAmount);

      y += 8;
      doc.moveTo(110, y - 4).lineTo(ticketWidth - 14, y - 4).strokeColor('#999999').stroke();
      doc.text('SUBTOTAL:', 126, y, { width: 58, align: 'right' });
      doc.text(this.formatMoney(subtotal), 186, y, { width: 26, align: 'right' });
      y += 9;
      doc.text('CORTESIA:', 126, y, { width: 58, align: 'right' });
      doc.text(`${courtesy} %`, 186, y, { width: 26, align: 'right' });
      y += 9;
      doc.text('DESC. TOTAL:', 126, y, { width: 58, align: 'right' });
      doc.text(this.formatMoney(discount), 186, y, { width: 26, align: 'right' });
      y += 9;
      doc.font('Helvetica-Bold').text('TOTAL:', 126, y, { width: 58, align: 'right' });
      doc.text(this.formatMoney(total), 186, y, { width: 26, align: 'right' });

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
        const gender = patient?.gender === 'male' ? 'Masculino' : 'Femenino';
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
      const subtotal = this.toNumber(merged.subtotalAmount);
      const courtesy = this.toNumber(merged.courtesyPercent);
      const discount = subtotal * (courtesy / 100);
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

  async generateTicketPdf(id: number) {
    const service = await this.findOne(id);
    return this.buildTicketPdfBuffer(service);
  }
}
