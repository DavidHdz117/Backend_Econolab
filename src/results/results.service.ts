import { Injectable, NotFoundException, BadRequestException, } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import fs from 'fs';
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
        result.serviceOrderItem?.studyNameSnapshot ?? 'Estudio';

      const formatDate = (value?: Date) => {
        if (!value) return 'N/D';
        try {
          return new Date(value).toLocaleString('es-MX');
        } catch {
          return new Date(value).toISOString();
        }
      };

      const calcAge = (birthDate?: string) => {
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
      };

      // Header (logo + lab info + folio/sucursal)
      const headerTop = doc.y;
      const logoBox = { x: 48, y: headerTop, w: 90, h: 50 };
      if (logoPath && fs.existsSync(logoPath)) {
        doc.image(logoPath, logoBox.x, logoBox.y, {
          fit: [logoBox.w, logoBox.h],
        });
      } else {
        doc
          .rect(logoBox.x, logoBox.y, logoBox.w, logoBox.h)
          .strokeColor('#cccccc')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#666666')
          .text('LOGO', logoBox.x, logoBox.y + 18, {
            width: logoBox.w,
            align: 'center',
          })
          .fillColor('black');
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(labName, 150, headerTop, { align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSubtitle, 150, headerTop + 16, { align: 'center' })
        .text(labAddress, 150, headerTop + 28, { align: 'center' })
        .text(labAddress2, 150, headerTop + 38, { align: 'center' });

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`SUC: ${service?.branchName ?? 'N/D'}`, 380, headerTop, {
          align: 'right',
        })
        .text(`FOLIO: ${service?.folio ?? 'N/D'}`, 380, headerTop + 14, {
          align: 'right',
        });

      doc.moveDown(3.6);
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.8);

      // Patient / Order info
      doc.font('Helvetica-Bold').fontSize(9).text('PACIENTE', 48, doc.y);
      doc.font('Helvetica').fontSize(9);
      doc.text(
        `Nombre: ${patient ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim() : 'N/D'}`,
        48,
        doc.y + 12,
      );
      doc.text(`Edad: ${calcAge(patient?.birthDate)}`, 48, doc.y + 24);
      doc.text(`Sexo: ${patient?.gender ?? 'N/D'}`, 48, doc.y + 36);
      doc.text(
        `Dirección: ${patient?.addressLine ?? 'N/D'}`,
        48,
        doc.y + 48,
      );

      doc.font('Helvetica-Bold').fontSize(9).text('MÉDICO', 300, doc.y - 60);
      doc.font('Helvetica').fontSize(9);
      doc.text(
        `Nombre: ${doctor ? `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`.trim() : 'N/D'}`,
        300,
        doc.y - 48,
      );
      doc.text(
        `Cédula: ${doctor?.licenseNumber ?? 'N/D'}`,
        300,
        doc.y - 36,
      );
      doc.text(
        `Especialidad: ${doctor?.specialty ?? 'N/D'}`,
        300,
        doc.y - 24,
      );
      doc.text(
        `Fecha de toma: ${formatDate(result.sampleAt ?? service?.sampleAt)}`,
        300,
        doc.y - 12,
      );
      doc.text(`Fecha de entrega: ${formatDate(result.reportedAt)}`, 300);

      doc.moveDown(2.4);
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.6);

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`ESTUDIO: ${studyName}`, { align: 'center' });
      doc.moveDown(0.2);
      if (result.method) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Método: ${result.method}`, { align: 'center' });
      }
      if (result.observations) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Observaciones: ${result.observations}`, { align: 'center' });
      }
      doc.moveDown(0.8);

      // Table header
      const tableStartY = doc.y;
      const colX = { label: 48, value: 280, unit: 380, ref: 460 };

      const drawTableHeader = () => {
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('Parámetro', colX.label, doc.y)
          .text('Resultado', colX.value, doc.y)
          .text('Unidad', colX.unit, doc.y)
          .text('Referencia', colX.ref, doc.y);
        doc.moveDown(0.4);
        doc
          .moveTo(48, doc.y)
          .lineTo(547, doc.y)
          .strokeColor('#cccccc')
          .stroke();
        doc.moveDown(0.3);
      };

      const ensureSpace = (needed: number) => {
        if (doc.y + needed > 760) {
          doc.addPage();
          drawTableHeader();
        }
      };

      drawTableHeader();

      const values = (result.values ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      doc.font('Helvetica').fontSize(10);
      for (const v of values) {
        ensureSpace(18);
        doc.text(v.label ?? 'N/D', colX.label, doc.y, { width: 220 });
        doc.text(v.value ?? '', colX.value, doc.y, { width: 90 });
        doc.text(v.unit ?? '', colX.unit, doc.y, { width: 70 });
        doc.text(v.referenceValue ?? '', colX.ref, doc.y, { width: 90 });
        doc.moveDown(0.6);
      }

      // Footer / signature
      doc.moveDown(1.2);
      const footerY = doc.y;

      // QR area
      if (qrBuffer) {
        doc.image(qrBuffer, 48, footerY, { width: 70, height: 70 });
      } else {
        doc
          .rect(48, footerY, 70, 70)
          .strokeColor('#cccccc')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#666666')
          .text('QR', 48, footerY + 28, { width: 70, align: 'center' })
          .fillColor('black');
      }
      doc
        .font('Helvetica')
        .fontSize(7)
        .text('Escanea para validar', 48, footerY + 56, {
          width: 70,
          align: 'center',
        });

      // Contact info
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(labSchedule, 130, footerY + 4)
        .text(labSampleSchedule, 130, footerY + 16)
        .text(`Email: ${labEmail}`, 130, footerY + 28)
        .text(`Tel: ${labPhone}`, 130, footerY + 40);

      // Signature area
      doc
        .font('Helvetica')
        .fontSize(9)
        .text('ATENTAMENTE', 360, footerY + 6, { align: 'right' });

      if (signaturePath && fs.existsSync(signaturePath)) {
        doc.image(signaturePath, 360, footerY + 14, {
          fit: [160, 50],
          align: 'right',
        });
      }

      doc
        .font('Helvetica')
        .fontSize(9)
        .text('______________________________', 360, footerY + 38, {
          align: 'right',
        })
        .text(responsibleName, 360, footerY + 52, {
          align: 'right',
        });

      if (responsibleLicense) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Céd. Prof. ${responsibleLicense}`, 360, footerY + 64, {
            align: 'right',
          });
      }

      doc.moveDown(5);
      doc
        .font('Helvetica')
        .fontSize(8)
        .text('Este resultado es confidencial y forma parte del expediente clínico.');

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
