import { Injectable, NotFoundException, BadRequestException, } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PDFDocument = require('pdfkit');
import * as fs from 'fs';
import * as QRCode from 'qrcode';
import {ServiceOrder,ServiceOrderItem,} from '../services/entities/service-order.entity';
import { StudyDetail } from '../studies/entities/study-detail.entity';
import { StudyResult, StudyResultValue } from './entities/study-result.entity';
import { CreateStudyResultDto } from './dto/create-study-result.dto';
import { UpdateStudyResultDto } from './dto/update-study-result.dto';
import { StudyResultValueDto } from './dto/study-result-value.dto';

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(StudyResult)
    private readonly resultRepo: Repository<StudyResult>,
    @InjectRepository(StudyResultValue)
    private readonly valueRepo: Repository<StudyResultValue>,
    @InjectRepository(ServiceOrder)
    private readonly serviceRepo: Repository<ServiceOrder>,
    @InjectRepository(ServiceOrderItem)
    private readonly itemRepo: Repository<ServiceOrderItem>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
  ) { }

  // ---------- Helpers ----------

  private mapValueDtoToEntity(
    dto: StudyResultValueDto,
    studyDetail?: StudyDetail,
  ): StudyResultValue {
    // Si viene el detalle, usamos sus datos como snapshot por defecto
    const baseLabel = studyDetail ? studyDetail.name : dto.label;
    const baseUnit = studyDetail ? studyDetail.unit : dto.unit;
    const baseRef = studyDetail ? studyDetail.referenceValue : dto.referenceValue;

    return this.valueRepo.create({
      studyDetailId: dto.studyDetailId ?? studyDetail?.id,
      label: baseLabel,
      unit: baseUnit,
      referenceValue: baseRef,
      value: dto.value,
      sortOrder: dto.sortOrder,
      visible: dto.visible,
    });
  }

  private async buildQrBuffer(result: StudyResult): Promise<Buffer | null> {
    const template = process.env.LAB_QR_URL ?? '';
    const base = process.env.LAB_QR_BASE_URL ?? '';
    const path =
      process.env.LAB_QR_PATH ?? `/results/${result.id}`;

    let url = template;
    if (!url && base) {
      url = `${base.replace(/\/$/, '')}${path}`;
    }
    if (!url) return null;

    const finalUrl = url.includes('{id}')
      ? url.replace('{id}', String(result.id))
      : url;

    try {
      return await QRCode.toBuffer(finalUrl, {
        type: 'png',
        width: 140,
        margin: 1,
      });
    } catch {
      return null;
    }
  }

  private async buildPdfBuffer(result: StudyResult): Promise<Buffer> {
    const qrBuffer = await this.buildQrBuffer(result);
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      const drawImageIfValid = (
        imagePath: string,
        x: number,
        y: number,
        options: Record<string, unknown>,
      ): boolean => {
        if (!imagePath || !fs.existsSync(imagePath)) {
          return false;
        }
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

      const labName = process.env.LAB_NAME ?? 'ECONOLAB';
      const labSubtitle =
        process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANÁLISIS CLÍNICOS';
      const labAddress = process.env.LAB_ADDRESS ?? 'Dirección no configurada';
      const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
      const labPhone = process.env.LAB_PHONE ?? 'Teléfono no configurado';
      const labEmail = process.env.LAB_EMAIL ?? 'Correo no configurado';
      const labSchedule = process.env.LAB_SCHEDULE ?? 'Horario no configurado';
      const labSampleSchedule =
        process.env.LAB_SAMPLE_SCHEDULE ?? 'Horario de toma no configurado';
      const logoPath = process.env.LAB_LOGO_PATH ?? '';
      const signaturePath = process.env.LAB_SIGNATURE_PATH ?? '';
      const responsibleName =
        process.env.LAB_RESPONSIBLE_NAME ?? 'Responsable Sanitario';
      const responsibleLicense =
        process.env.LAB_RESPONSIBLE_LICENSE ?? '';

      const service = result.serviceOrder;
      const patient = service?.patient;
      const doctor = service?.doctor;

      const studyName =
        result.serviceOrderItem?.studyNameSnapshot ?? '';

      const formatDate = (value?: Date) => {
        if (!value) return '';
        try {
          return new Date(value).toLocaleString('es-MX');
        } catch {
          return '';
        }
      };

      const calcAge = (birthDate?: string) => {
        if (!birthDate) return '';
        const birth = new Date(birthDate);
        if (Number.isNaN(birth.getTime())) return '';
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
          age -= 1;
        }
        return `${age} años`;
      };

      const left = 48;
      const right = 547;
      const headerY = 48;
      const logoBox = { x: left, y: headerY, w: 90, h: 50 };

      const hasLogo = drawImageIfValid(logoPath, logoBox.x, logoBox.y, {
        fit: [logoBox.w, logoBox.h],
      });
      if (!hasLogo) {
        doc.rect(logoBox.x, logoBox.y, logoBox.w, logoBox.h).strokeColor('#cccccc').stroke();
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#666666')
          .text('LOGO', logoBox.x, logoBox.y + 18, { width: logoBox.w, align: 'center' })
          .fillColor('black');
      }

      doc.font('Helvetica-Bold').fontSize(18).text(labName, 160, headerY - 2, { width: 220, align: 'center' });
      doc.font('Helvetica').fontSize(9).text(labSubtitle, 160, headerY + 22, { width: 220, align: 'center' });
      doc.text(labAddress, 160, headerY + 34, { width: 220, align: 'center' });
      if (labAddress2) {
        doc.text(labAddress2, 160, headerY + 46, { width: 220, align: 'center' });
      }

      doc.font('Helvetica-Bold').fontSize(12).text(`SUC: ${service?.branchName ?? ''}`, 390, headerY, { width: 157, align: 'right' });
      doc.text(`FOLIO: ${service?.folio ?? ''}`, 390, headerY + 20, { width: 157, align: 'right' });

      doc.moveTo(left, 126).lineTo(right, 126).strokeColor('#bdbdbd').stroke();

      const infoTop = 140;
      doc.font('Helvetica-Bold').fontSize(11).text('PACIENTE', left, infoTop);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Nombre: ${patient ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim() : ''}`, left, infoTop + 24, { width: 230 });
      doc.text(`Edad: ${calcAge(patient?.birthDate)}`, left, infoTop + 52, { width: 230 });
      doc.text(`Sexo: ${patient?.gender ?? ''}`, left, infoTop + 80, { width: 230 });
      doc.text(`Direccion: ${patient?.addressLine ?? ''}`, left, infoTop + 108, { width: 230 });

      const doctorX = 300;
      doc.font('Helvetica-Bold').fontSize(11).text('MEDICO', doctorX, infoTop);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Nombre: ${doctor ? `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`.trim() : ''}`, doctorX, infoTop + 24, { width: 247 });
      doc.text(`Cedula: ${doctor?.licenseNumber ?? ''}`, doctorX, infoTop + 40, { width: 247 });
      doc.text(`Especialidad: ${doctor?.specialty ?? ''}`, doctorX, infoTop + 56, { width: 247 });
      doc.text(`Fecha de toma: ${formatDate(result.sampleAt ?? service?.sampleAt)}`, doctorX, infoTop + 72, { width: 247 });
      doc.text(`Fecha de entrega: ${formatDate(result.reportedAt)}`, doctorX, infoTop + 88, { width: 247 });

      doc.moveTo(left, 252).lineTo(right, 252).strokeColor('#bdbdbd').stroke();

      doc.font('Helvetica-Bold').fontSize(13).text(`ESTUDIO: ${studyName}`, left, 262, { width: right - left, align: 'center' });
      if (result.method) {
        doc.font('Helvetica').fontSize(9).text(`Metodo: ${result.method}`, left, 278, { width: right - left, align: 'center' });
      }

      const tableY = result.method ? 298 : 286;
      const colX = { label: left, value: 280, unit: 380, ref: 460 };

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('Parametro', colX.label, tableY, { width: 210 })
        .text('Resultado', colX.value, tableY, { width: 90 })
        .text('Unidad', colX.unit, tableY, { width: 70 })
        .text('Referencia', colX.ref, tableY, { width: 87 });
      doc.moveTo(left, tableY + 18).lineTo(right, tableY + 18).strokeColor('#cfcfcf').stroke();

      let cursorY = tableY + 28;
      const values = (result.values ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      doc.font('Helvetica').fontSize(10);
      for (const v of values) {
        if (cursorY > 610) {
          doc.addPage();
          cursorY = 70;
          doc
            .font('Helvetica-Bold')
            .fontSize(11)
            .text('Parametro', colX.label, cursorY, { width: 210 })
            .text('Resultado', colX.value, cursorY, { width: 90 })
            .text('Unidad', colX.unit, cursorY, { width: 70 })
            .text('Referencia', colX.ref, cursorY, { width: 87 });
          doc.moveTo(left, cursorY + 18).lineTo(right, cursorY + 18).strokeColor('#cfcfcf').stroke();
          cursorY += 28;
          doc.font('Helvetica').fontSize(10);
        }

        doc.text(v.label ?? '', colX.label, cursorY, { width: 210 });
        doc.text(v.value ?? '', colX.value, cursorY, { width: 90 });
        doc.text(v.unit ?? '', colX.unit, cursorY, { width: 70 });
        doc.text(v.referenceValue ?? '', colX.ref, cursorY, { width: 87 });
        cursorY += 18;
      }

      let footerY = Math.max(cursorY + 20, 460);
      if (footerY > 690) {
        doc.addPage();
        footerY = 620;
      }

      doc.moveTo(left, footerY - 10).lineTo(right, footerY - 10).strokeColor('#bdbdbd').stroke();

      if (qrBuffer) {
        doc.image(qrBuffer, left, footerY + 6, { width: 72, height: 72 });
      } else {
        doc.rect(left, footerY + 6, 72, 72).strokeColor('#cccccc').stroke();
        doc.font('Helvetica').fontSize(7).fillColor('#666666').text('QR', left, footerY + 36, { width: 72, align: 'center' }).fillColor('black');
      }
      doc.font('Helvetica').fontSize(7).text('ESCANEA QR PARA', left, footerY + 80, { width: 72, align: 'center' });
      doc.text('VALIDAR RESULTADOS', left, footerY + 88, { width: 72, align: 'center' });

      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSchedule, 132, footerY + 12)
        .text(labSampleSchedule, 132, footerY + 28)
        .text(`Email: ${labEmail}`, 132, footerY + 44)
        .text(`Tel: ${labPhone}`, 132, footerY + 60);

      doc.font('Helvetica').fontSize(13).text('ATENTAMENTE', 360, footerY + 18, { width: 187, align: 'right' });
      drawImageIfValid(signaturePath, 360, footerY + 30, { fit: [160, 54], align: 'right' });
      doc.moveTo(360, footerY + 84).lineTo(547, footerY + 84).strokeColor('#202020').stroke();
      doc.font('Helvetica').fontSize(11).text(responsibleName, 360, footerY + 90, { width: 187, align: 'right' });
      if (responsibleLicense) {
        doc.text(`Ced. Prof. ${responsibleLicense}`, 360, footerY + 106, { width: 187, align: 'right' });
      }

      doc
        .font('Helvetica')
        .fontSize(8)
        .text('Este resultado es confidencial y forma parte del expediente clinico.', 360, footerY + 130, {
          width: 187,
          align: 'left',
        });

      doc.end();
    });
  }

  // ---------- Plantilla / borrador ----------

  /**
   * Devuelve un resultado de estudio para un item de servicio.
   * Si no existe aún, crea un borrador vacío tomando los StudyDetail
   * del estudio configurado, para que el front solo llene los RESULTADO.
   *
   * Ideal para la pantalla a la que llegas desde "Acciones -> Resultados".
   */
  async getOrCreateDraftByServiceItem(serviceOrderItemId: number) {
    let existing = await this.resultRepo.findOne({
      where: { serviceOrderItemId, isActive: true },
    });
    if (existing) return existing;

    const item = await this.itemRepo.findOne({
      where: { id: serviceOrderItemId },
      relations: ['serviceOrder'],
    });

    if (!item || !item.serviceOrder || !item.serviceOrder.isActive) {
      throw new NotFoundException(
        'No se encontró el estudio dentro del servicio.',
      );
    }

    // Traemos los detalles configurados del estudio (GLUCOSA, UREA, etc.)
    const details = await this.detailRepo.find({
      where: { studyId: item.studyId, isActive: true },
      order: { sortOrder: 'ASC' },
    });

    const values = details.map((d) =>
      this.valueRepo.create({
        studyDetailId: d.id,
        label: d.name,
        unit: d.unit,
        referenceValue: d.referenceValue,
        sortOrder: d.sortOrder,
        visible: true,
      }),
    );

    const draft = this.resultRepo.create({
      serviceOrderId: item.serviceOrderId,
      serviceOrderItemId,
      sampleAt: item.serviceOrder.sampleAt,
      isDraft: true,
      isActive: true,
      values,
    });

    return this.resultRepo.save(draft);
  }

  // ---------- CRUD ----------

  async findOne(id: number) {
    const result = await this.resultRepo.findOne({
      where: { id, isActive: true },
    });
    if (!result) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return result;
  }

  async generatePdf(id: number) {
    const result = await this.resultRepo.findOne({
      where: { id, isActive: true },
      relations: {
        serviceOrder: { patient: true, doctor: true, items: true },
        serviceOrderItem: true,
        values: true,
      },
    });
    if (!result) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return this.buildPdfBuffer(result);
  }

  async findByServiceItem(serviceOrderItemId: number) {
    const result = await this.resultRepo.findOne({
      where: { serviceOrderItemId, isActive: true },
    });
    if (!result) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return result;
  }

  async create(dto: CreateStudyResultDto) {
    const service = await this.serviceRepo.findOne({
      where: { id: dto.serviceOrderId, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('El servicio clínico no existe o está inactivo.');
    }

    const item = await this.itemRepo.findOne({
      where: {
        id: dto.serviceOrderItemId,
        serviceOrderId: dto.serviceOrderId,
      },
    });
    if (!item) {
      throw new NotFoundException(
        'El estudio indicado no pertenece a este servicio.',
      );
    }

    const existing = await this.resultRepo.findOne({
      where: { serviceOrderItemId: dto.serviceOrderItemId, isActive: true },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya existen resultados registrados para este estudio. Utiliza la edición.',
      );
    }

    const values: StudyResultValue[] = [];

    for (const valueDto of dto.values) {
      let detail: StudyDetail | undefined;
      if (valueDto.studyDetailId) {
        const foundDetail = await this.detailRepo.findOne({
          where: { id: valueDto.studyDetailId },
        });
        detail = foundDetail || undefined;
      }
      values.push(this.mapValueDtoToEntity(valueDto, detail));
    }

    const entity = this.resultRepo.create({
      serviceOrderId: dto.serviceOrderId,
      serviceOrderItemId: dto.serviceOrderItemId,
      sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : service.sampleAt,
      reportedAt: dto.reportedAt ? new Date(dto.reportedAt) : undefined,
      method: dto.method,
      observations: dto.observations,
      isDraft: dto.isDraft ?? true,
      isActive: true,
      values,
    });

    return this.resultRepo.save(entity);
  }

  async update(id: number, dto: UpdateStudyResultDto) {
    const result = await this.findOne(id);

    if (
      dto.serviceOrderId &&
      dto.serviceOrderId !== result.serviceOrderId
    ) {
      throw new BadRequestException(
        'No se puede cambiar el servicio clínico de un resultado.',
      );
    }

    if (
      dto.serviceOrderItemId &&
      dto.serviceOrderItemId !== result.serviceOrderItemId
    ) {
      throw new BadRequestException(
        'No se puede cambiar el estudio asociado al resultado.',
      );
    }

    // Si vienen values, borramos los actuales y creamos nuevos
    if (dto.values && dto.values.length > 0) {
      await this.valueRepo.delete({ studyResultId: id });

      const newValues: StudyResultValue[] = [];
      for (const valueDto of dto.values) {
        let detail: StudyDetail | undefined;
        if (valueDto.studyDetailId) {
          const foundDetail = await this.detailRepo.findOne({
            where: { id: valueDto.studyDetailId },
          });
          detail = foundDetail || undefined;
        }
        newValues.push(this.mapValueDtoToEntity(valueDto, detail));
      }
      result.values = newValues;
    }

    if (dto.sampleAt) {
      result.sampleAt = new Date(dto.sampleAt);
    }
    if (dto.reportedAt) {
      result.reportedAt = new Date(dto.reportedAt);
    }

    if (dto.method !== undefined) {
      result.method = dto.method;
    }
    if (dto.observations !== undefined) {
      result.observations = dto.observations;
    }
    if (dto.isDraft !== undefined) {
      result.isDraft = dto.isDraft;
    }

    return this.resultRepo.save(result);
  }

  async softDelete(id: number) {
    const result = await this.findOne(id);
    result.isActive = false;
    await this.resultRepo.save(result);
    return { message: 'Resultado desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const res = await this.resultRepo.delete({ id });
    if (res.affected === 0) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return { message: 'Resultado eliminado definitivamente.' };
  }
}

