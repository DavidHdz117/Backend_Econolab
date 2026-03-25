import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument = require('pdfkit');
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as QRCode from 'qrcode';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import {
  StudyDetail,
  StudyDetailType,
} from '../studies/entities/study-detail.entity';
import { StudyResult, StudyResultValue } from './entities/study-result.entity';
import { CreateStudyResultDto } from './dto/create-study-result.dto';
import { UpdateStudyResultDto } from './dto/update-study-result.dto';
import { StudyResultValueDto } from './dto/study-result-value.dto';

type ResultPdfCategoryLayout = 'continuous' | 'page-per-category';
type ResultPdfStudyLayout = 'continuous' | 'page-per-study';

type ResultPdfOptions = {
  includeSignature: boolean;
  categoryLayout: ResultPdfCategoryLayout;
  studyLayout: ResultPdfStudyLayout;
};

type ResultValueGroup = {
  title?: string;
  rows: StudyResultValue[];
};

type ResultPdfDoc = InstanceType<typeof PDFDocument>;

type ResultPdfColumns = {
  label: number;
  value: number;
  unit: number;
  ref: number;
};

type ResultPdfSection = {
  result: StudyResult;
  studyName: string;
  packageName?: string;
  studyDetails: StudyDetail[];
};

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
  ) {}

  // ---------- Helpers ----------

  private mapValueDtoToEntity(
    dto: StudyResultValueDto,
    studyDetail?: StudyDetail,
  ): StudyResultValue {
    // Si viene el detalle, usamos sus datos como snapshot por defecto
    const baseLabel = studyDetail ? studyDetail.name : dto.label;
    const baseUnit = studyDetail ? studyDetail.unit : dto.unit;
    const baseRef = studyDetail
      ? studyDetail.referenceValue
      : dto.referenceValue;

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
    const path = process.env.LAB_QR_PATH ?? `/results/${result.id}`;

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

  private formatDocumentDate(value?: Date) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const pad = (segment: number) => String(segment).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private formatAgeLabel(birthDate?: string) {
    if (!birthDate) return '';
    const birth = new Date(birthDate);
    if (Number.isNaN(birth.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDelta = today.getMonth() - birth.getMonth();
    if (
      monthDelta < 0 ||
      (monthDelta === 0 && today.getDate() < birth.getDate())
    ) {
      age -= 1;
    }

    return `${age} años`;
  }

  private formatGenderLabel(gender?: string | null) {
    switch (gender) {
      case 'male':
        return 'Masculino';
      case 'female':
        return 'Femenino';
      case 'other':
        return 'Otro';
      default:
        return 'N/D';
    }
  }

  private buildPersonName(
    firstName?: string | null,
    lastName?: string | null,
    middleName?: string | null,
  ) {
    return [firstName, lastName, middleName]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private displayText(value?: string | null) {
    return value?.trim() || 'N/D';
  }

  private formatBirthDateLabel(value?: string | null) {
    if (!value) return 'N/D';

    try {
      return new Date(`${value}T00:00:00`).toLocaleDateString('es-MX');
    } catch {
      return value;
    }
  }

  private normalizePdfOptions(
    rawOptions?: Record<string, string | string[] | undefined>,
  ): ResultPdfOptions {
    const read = (value?: string | string[]) =>
      (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();

    const signature = read(rawOptions?.signature);
    const categoryLayout = read(rawOptions?.categoryLayout);
    const studyLayout = read(rawOptions?.studyLayout);

    return {
      includeSignature: !['without', 'false', '0', 'sin'].includes(
        signature ?? '',
      ),
      categoryLayout:
        categoryLayout === 'page-per-category'
          ? 'page-per-category'
          : 'continuous',
      studyLayout:
        studyLayout === 'page-per-study' ? 'page-per-study' : 'continuous',
    };
  }

  private groupResultValues(
    values: StudyResultValue[],
    studyDetails: StudyDetail[],
  ): ResultValueGroup[] {
    const visibleValues = (values ?? [])
      .filter((value) => value.visible !== false)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (visibleValues.length === 0) {
      return [];
    }

    const detailById = new Map(
      studyDetails.map((detail) => [detail.id, detail] as const),
    );
    const groupedValueIds = new Set<number>();
    const groups: ResultValueGroup[] = [];

    const categories = studyDetails
      .filter(
        (detail) =>
          detail.dataType === StudyDetailType.CATEGORY &&
          detail.isActive !== false,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);

    for (const category of categories) {
      const rows = visibleValues.filter((value) => {
        const detail = detailById.get(value.studyDetailId ?? -1);
        return detail?.parentId === category.id;
      });

      if (rows.length === 0) {
        continue;
      }

      rows.forEach((row) => groupedValueIds.add(row.id));
      groups.push({
        title: category.name,
        rows,
      });
    }

    const uncategorizedRows = visibleValues.filter(
      (value) => !groupedValueIds.has(value.id),
    );

    if (uncategorizedRows.length > 0 || groups.length === 0) {
      groups.push({
        title:
          uncategorizedRows.length > 0 && groups.length > 0
            ? 'Sin categoria'
            : undefined,
        rows: uncategorizedRows.length > 0 ? uncategorizedRows : visibleValues,
      });
    }

    return groups;
  }

  private drawResultTableHeader(
    doc: ResultPdfDoc,
    left: number,
    right: number,
    y: number,
    columns: ResultPdfColumns,
  ) {
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Parametro', columns.label, y, { width: 210 })
      .text('Resultado', columns.value, y, { width: 90 })
      .text('Unidad', columns.unit, y, { width: 70 })
      .text('Referencia', columns.ref, y, { width: 87 });
    doc
      .moveTo(left, y + 18)
      .lineTo(right, y + 18)
      .strokeColor('#cfcfcf')
      .stroke();

    return y + 28;
  }

  private drawResultGroupTitle(
    doc: ResultPdfDoc,
    left: number,
    right: number,
    y: number,
    title?: string,
  ) {
    if (!title) {
      return y;
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#356e93')
      .text(title, left, y, {
        width: right - left,
      })
      .fillColor('black');

    return y + 18;
  }

  private async getStudyDetailsMap(studyIds: number[]) {
    const uniqueStudyIds = [...new Set(studyIds)];
    const entries = await Promise.all(
      uniqueStudyIds.map(async (studyId) => {
        const details = await this.detailRepo.find({
          where: { studyId, isActive: true },
          order: { sortOrder: 'ASC' },
        });

        return [studyId, details] as const;
      }),
    );

    return new Map<number, StudyDetail[]>(entries);
  }

  private async buildPdfBufferWithOptions(
    result: StudyResult,
    studyDetails: StudyDetail[],
    options: ResultPdfOptions,
  ): Promise<Buffer> {
    const qrBuffer = await this.buildQrBuffer(result);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
      const chunks: Buffer[] = [];

      const drawImageIfValid = (
        imagePath: string,
        x: number,
        y: number,
        drawOptions: Record<string, unknown>,
      ): boolean => {
        if (!imagePath || !fs.existsSync(imagePath)) {
          return false;
        }
        try {
          doc.image(imagePath, x, y, drawOptions);
          return true;
        } catch {
          return false;
        }
      };

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('error', (err: unknown) =>
        reject(
          err instanceof Error
            ? err
            : new Error('No se pudo generar el PDF del resultado.'),
        ),
      );
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const labName = process.env.LAB_NAME ?? 'ECONOLAB';
      const labSubtitle =
        process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
      const labAddress = process.env.LAB_ADDRESS ?? 'Direccion no configurada';
      const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
      const labPhone = process.env.LAB_PHONE ?? 'Telefono no configurado';
      const labEmail = process.env.LAB_EMAIL ?? 'Correo no configurado';
      const labSchedule = process.env.LAB_SCHEDULE ?? 'Horario no configurado';
      const labSampleSchedule =
        process.env.LAB_SAMPLE_SCHEDULE ?? 'Horario de toma no configurado';
      const logoPath = process.env.LAB_LOGO_PATH ?? '@src\public\logoeco.png';
      const signaturePath = process.env.LAB_SIGNATURE_PATH ?? '';
      const responsibleName =
        process.env.LAB_RESPONSIBLE_NAME ?? 'Responsable Sanitario';
      const responsibleLicense = process.env.LAB_RESPONSIBLE_LICENSE ?? '';

      const service = result.serviceOrder;
      const patient = service?.patient;
      const doctor = service?.doctor;
      const studyName = result.serviceOrderItem?.studyNameSnapshot ?? '';
      const groups = this.groupResultValues(result.values ?? [], studyDetails);
      const left = 48;
      const right = doc.page.width - left;
      const pageBottom = doc.page.height - 48;
      const headerY = 48;
      const logoBox = { x: left, y: headerY, w: 90, h: 50 };
      const columns: ResultPdfColumns = {
        label: left,
        value: 280,
        unit: 380,
        ref: 460,
      };
      const signatureWidth = 187;
      const signatureX = right - signatureWidth;
      const footerBlockHeight = options.includeSignature ? 150 : 110;

      const patientName = this.buildPersonName(
        patient?.firstName,
        patient?.lastName,
        patient?.middleName,
      );
      const doctorName = this.buildPersonName(
        doctor?.firstName,
        doctor?.lastName,
        doctor?.middleName,
      );
      const doctorDisplayName = doctorName || 'A QUIEN CORRESPONDA';
      const patientBirthDate = this.formatBirthDateLabel(patient?.birthDate);
      const patientAge = this.displayText(
        this.formatAgeLabel(patient?.birthDate),
      );
      const patientGender = this.displayText(
        this.formatGenderLabel(patient?.gender),
      );
      const patientPhone = this.displayText(patient?.phone);
      const patientAddress = this.displayText(patient?.addressLine);
      const patientBetween = this.displayText(patient?.addressBetween);
      const doctorLicense = this.displayText(doctor?.licenseNumber);
      const doctorSpecialty = this.displayText(doctor?.specialty);
      const sampleDate = this.displayText(
        this.formatDocumentDate(result.sampleAt ?? service?.sampleAt),
      );
      const deliveryDate = this.displayText(
        this.formatDocumentDate(result.reportedAt),
      );

      const resetTableOnNewPage = (groupTitle?: string) => {
        doc.addPage();
        let nextY = this.drawResultTableHeader(doc, left, right, 70, columns);
        nextY = this.drawResultGroupTitle(doc, left, right, nextY, groupTitle);
        doc.font('Helvetica').fontSize(10);
        return nextY;
      };

      const hasLogo = drawImageIfValid(logoPath, logoBox.x, logoBox.y, {
        fit: [logoBox.w, logoBox.h],
      });
      if (!hasLogo) {
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
        .fontSize(18)
        .text(labName, 160, headerY - 2, { width: 220, align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSubtitle, 160, headerY + 22, { width: 220, align: 'center' });
      doc.text(labAddress, 160, headerY + 34, { width: 220, align: 'center' });
      if (labAddress2) {
        doc.text(labAddress2, 160, headerY + 46, {
          width: 220,
          align: 'center',
        });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(`SUC: ${this.displayText(service?.branchName)}`, 390, headerY, {
          width: right - 390,
          align: 'right',
        });
      doc.text(
        `FOLIO: ${this.displayText(service?.folio)}`,
        390,
        headerY + 20,
        {
          width: right - 390,
          align: 'right',
        },
      );

      doc.moveTo(left, 126).lineTo(right, 126).strokeColor('#bdbdbd').stroke();

      const infoTop = 140;
      doc.font('Helvetica-Bold').fontSize(11).text('PACIENTE', left, infoTop);
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Nombre: ${this.displayText(patientName)}`, left, infoTop + 22, {
        width: 230,
      });
      doc.text(`Fecha nac.: ${patientBirthDate}`, left, infoTop + 38, {
        width: 230,
      });
      doc.text(`Edad: ${patientAge}`, left, infoTop + 54, { width: 230 });
      doc.text(`Tel: ${patientPhone}`, left, infoTop + 70, { width: 230 });
      doc.text(`Sexo: ${patientGender}`, left, infoTop + 86, { width: 230 });
      doc.text(`Direccion: ${patientAddress}`, left, infoTop + 102, {
        width: 230,
      });
      doc.text(`Entre calles: ${patientBetween}`, left, infoTop + 118, {
        width: 230,
      });

      const doctorX = 300;
      doc.font('Helvetica-Bold').fontSize(11).text('MEDICO', doctorX, infoTop);
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Doctor(a): ${doctorDisplayName}`, doctorX, infoTop + 22, {
        width: 247,
      });
      doc.text(`Cedula: ${doctorLicense}`, doctorX, infoTop + 38, {
        width: 247,
      });
      doc.text(`Especialidad: ${doctorSpecialty}`, doctorX, infoTop + 54, {
        width: 247,
      });
      doc.text(
        `Fecha de toma de muestra: ${sampleDate}`,
        doctorX,
        infoTop + 70,
        {
          width: 247,
        },
      );
      doc.text(
        `Fecha de entrega de resultado: ${deliveryDate}`,
        doctorX,
        infoTop + 86,
        { width: 247 },
      );

      doc.moveTo(left, 272).lineTo(right, 272).strokeColor('#bdbdbd').stroke();

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor('#356e93')
        .text(`ESTUDIO: ${studyName}`, left, 282, {
          width: right - left,
          align: 'center',
        })
        .fillColor('black');
      if (result.method) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Metodo: ${result.method}`, left, 298, {
            width: right - left,
            align: 'center',
          });
      }

      const tableY = result.method ? 318 : 306;
      let cursorY = this.drawResultTableHeader(
        doc,
        left,
        right,
        tableY,
        columns,
      );
      doc.font('Helvetica').fontSize(10);

      if (groups.length === 0) {
        doc.text('Sin parametros visibles para mostrar.', left, cursorY, {
          width: right - left,
        });
        cursorY += 24;
      } else {
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex];

          if (
            options.categoryLayout === 'page-per-category' &&
            groupIndex > 0
          ) {
            cursorY = resetTableOnNewPage();
          } else if (cursorY > pageBottom - 160) {
            cursorY = resetTableOnNewPage();
          }

          cursorY = this.drawResultGroupTitle(
            doc,
            left,
            right,
            cursorY,
            group.title,
          );
          doc.font('Helvetica').fontSize(10);

          for (const value of group.rows) {
            if (cursorY > pageBottom - 140) {
              cursorY = resetTableOnNewPage(group.title);
            }

            doc.text(value.label ?? '', columns.label, cursorY, { width: 210 });
            doc.text(value.value ?? '', columns.value, cursorY, { width: 90 });
            doc.text(value.unit ?? '', columns.unit, cursorY, { width: 70 });
            doc.text(value.referenceValue ?? '', columns.ref, cursorY, {
              width: 87,
            });
            cursorY += 18;
          }

          cursorY += 10;
        }
      }

      let footerY = Math.max(cursorY + 20, pageBottom - footerBlockHeight);
      if (footerY + footerBlockHeight > pageBottom) {
        doc.addPage();
        footerY = doc.page.height - 48 - footerBlockHeight;
      }

      doc
        .moveTo(left, footerY - 10)
        .lineTo(right, footerY - 10)
        .strokeColor('#bdbdbd')
        .stroke();

      if (qrBuffer) {
        doc.image(qrBuffer, left, footerY + 6, { width: 72, height: 72 });
      } else {
        doc
          .rect(left, footerY + 6, 72, 72)
          .strokeColor('#cccccc')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#666666')
          .text('QR', left, footerY + 36, { width: 72, align: 'center' })
          .fillColor('black');
      }
      doc
        .font('Helvetica')
        .fontSize(7)
        .text('ESCANEA QR PARA', left, footerY + 80, {
          width: 72,
          align: 'center',
        });
      doc.text('VALIDAR RESULTADOS', left, footerY + 88, {
        width: 72,
        align: 'center',
      });

      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSchedule, 132, footerY + 12)
        .text(labSampleSchedule, 132, footerY + 28)
        .text(`Correo: ${labEmail}`, 132, footerY + 44)
        .text(`Telefono: ${labPhone}`, 132, footerY + 60);

      if (options.includeSignature) {
        doc
          .font('Helvetica')
          .fontSize(13)
          .text('ATENTAMENTE', signatureX, footerY + 18, {
            width: signatureWidth,
            align: 'right',
          });
        drawImageIfValid(signaturePath, signatureX, footerY + 30, {
          fit: [160, 54],
          align: 'right',
        });
        doc
          .moveTo(signatureX, footerY + 84)
          .lineTo(right, footerY + 84)
          .strokeColor('#202020')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(11)
          .text(responsibleName, signatureX, footerY + 90, {
            width: signatureWidth,
            align: 'right',
          });
        if (responsibleLicense) {
          doc.text(
            `Ced. Prof. ${responsibleLicense}`,
            signatureX,
            footerY + 106,
            {
              width: signatureWidth,
              align: 'right',
            },
          );
        }
        doc
          .font('Helvetica')
          .fontSize(8)
          .text(
            'Este resultado es confidencial y forma parte del expediente clinico.',
            signatureX,
            footerY + 130,
            {
              width: signatureWidth,
              align: 'left',
            },
          );
      } else {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text('Documento emitido sin firma.', signatureX, footerY + 18, {
            width: signatureWidth,
            align: 'right',
          });
        doc
          .font('Helvetica')
          .fontSize(8)
          .text(
            'Este resultado es confidencial y forma parte del expediente clinico.',
            signatureX,
            footerY + 42,
            {
              width: signatureWidth,
              align: 'left',
            },
          );
      }

      doc.end();
    });
  }

  private async buildServicePdfBufferWithOptions(
    service: ServiceOrder,
    sections: ResultPdfSection[],
    options: ResultPdfOptions,
  ): Promise<Buffer> {
    const qrBuffer = sections[0]
      ? await this.buildQrBuffer(sections[0].result)
      : null;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
      const chunks: Buffer[] = [];

      const drawImageIfValid = (
        imagePath: string,
        x: number,
        y: number,
        drawOptions: Record<string, unknown>,
      ): boolean => {
        if (!imagePath || !fs.existsSync(imagePath)) {
          return false;
        }
        try {
          doc.image(imagePath, x, y, drawOptions);
          return true;
        } catch {
          return false;
        }
      };

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('error', (err: unknown) =>
        reject(
          err instanceof Error
            ? err
            : new Error('No se pudo generar el PDF del servicio.'),
        ),
      );
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const labName = process.env.LAB_NAME ?? 'ECONOLAB';
      const labSubtitle =
        process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
      const labAddress = process.env.LAB_ADDRESS ?? 'Direccion no configurada';
      const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
      const labPhone = process.env.LAB_PHONE ?? 'Telefono no configurado';
      const labEmail = process.env.LAB_EMAIL ?? 'Correo no configurado';
      const labSchedule = process.env.LAB_SCHEDULE ?? 'Horario no configurado';
      const labSampleSchedule =
        process.env.LAB_SAMPLE_SCHEDULE ?? 'Horario de toma no configurado';
      const logoPath = process.env.LAB_LOGO_PATH ?? '@src\public\logoeco.png';
      const signaturePath = process.env.LAB_SIGNATURE_PATH ?? '';
      const responsibleName =
        process.env.LAB_RESPONSIBLE_NAME ?? 'Responsable Sanitario';
      const responsibleLicense = process.env.LAB_RESPONSIBLE_LICENSE ?? '';

      const patient = service.patient;
      const doctor = service.doctor;
      const left = 48;
      const right = doc.page.width - left;
      const pageBottom = doc.page.height - 48;
      const headerY = 48;
      const logoBox = { x: left, y: headerY, w: 90, h: 50 };
      const columns: ResultPdfColumns = {
        label: left,
        value: 280,
        unit: 380,
        ref: 460,
      };
      const signatureWidth = 187;
      const signatureX = right - signatureWidth;
      const footerBlockHeight = options.includeSignature ? 150 : 110;
      const combinedStudyTitle =
        options.studyLayout === 'page-per-study'
          ? 'RESULTADOS DE ESTUDIOS'
          : sections
              .map((section) => section.studyName)
              .filter((name) => Boolean(name?.trim()))
              .join(', ') || 'RESULTADOS';

      const patientName = this.buildPersonName(
        patient?.firstName,
        patient?.lastName,
        patient?.middleName,
      );
      const doctorName = this.buildPersonName(
        doctor?.firstName,
        doctor?.lastName,
        doctor?.middleName,
      );
      const doctorDisplayName = doctorName || 'A QUIEN CORRESPONDA';
      const patientBirthDate = this.formatBirthDateLabel(patient?.birthDate);
      const patientAge = this.displayText(
        this.formatAgeLabel(patient?.birthDate),
      );
      const patientGender = this.displayText(
        this.formatGenderLabel(patient?.gender),
      );
      const patientPhone = this.displayText(patient?.phone);
      const patientAddress = this.displayText(patient?.addressLine);
      const patientBetween = this.displayText(patient?.addressBetween);
      const doctorLicense = this.displayText(doctor?.licenseNumber);
      const doctorSpecialty = this.displayText(doctor?.specialty);
      const sampleDate = this.displayText(
        this.formatDocumentDate(service.sampleAt),
      );
      const deliveryDate = this.displayText(
        this.formatDocumentDate(service.deliveryAt),
      );

      const sectionLabel = (section: ResultPdfSection) =>
        section.packageName
          ? `${section.packageName} / ${section.studyName}`
          : section.studyName;

      const drawSectionHeader = (section: ResultPdfSection, y: number) => {
        const showSectionTitle =
          sections.length > 1 ||
          Boolean(section.packageName) ||
          options.studyLayout === 'page-per-study';
        let nextY = y;

        if (showSectionTitle) {
          doc
            .font('Helvetica-Bold')
            .fontSize(12)
            .text(sectionLabel(section), left, nextY, {
              width: right - left,
              align: 'center',
            });
          nextY += 18;
        }

        if (section.result.method) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .text(`Metodo: ${section.result.method}`, left, nextY, {
              width: right - left,
              align: 'center',
            });
          nextY += 16;
        }

        nextY = this.drawResultTableHeader(doc, left, right, nextY, columns);
        doc.font('Helvetica').fontSize(10);
        return nextY;
      };

      const resetSectionOnNewPage = (
        section: ResultPdfSection,
        groupTitle?: string,
      ) => {
        doc.addPage();
        let nextY = drawSectionHeader(section, 70);
        nextY = this.drawResultGroupTitle(doc, left, right, nextY, groupTitle);
        doc.font('Helvetica').fontSize(10);
        return nextY;
      };

      const hasLogo = drawImageIfValid(logoPath, logoBox.x, logoBox.y, {
        fit: [logoBox.w, logoBox.h],
      });
      if (!hasLogo) {
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
        .fontSize(18)
        .text(labName, 160, headerY - 2, { width: 220, align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSubtitle, 160, headerY + 22, { width: 220, align: 'center' });
      doc.text(labAddress, 160, headerY + 34, { width: 220, align: 'center' });
      if (labAddress2) {
        doc.text(labAddress2, 160, headerY + 46, {
          width: 220,
          align: 'center',
        });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(`SUC: ${this.displayText(service.branchName)}`, 390, headerY, {
          width: right - 390,
          align: 'right',
        });
      doc.text(`FOLIO: ${this.displayText(service.folio)}`, 390, headerY + 20, {
        width: right - 390,
        align: 'right',
      });

      doc.moveTo(left, 126).lineTo(right, 126).strokeColor('#bdbdbd').stroke();

      const infoTop = 140;
      doc.font('Helvetica-Bold').fontSize(11).text('PACIENTE', left, infoTop);
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Nombre: ${this.displayText(patientName)}`, left, infoTop + 22, {
        width: 230,
      });
      doc.text(`Fecha nac.: ${patientBirthDate}`, left, infoTop + 38, {
        width: 230,
      });
      doc.text(`Edad: ${patientAge}`, left, infoTop + 54, { width: 230 });
      doc.text(`Tel: ${patientPhone}`, left, infoTop + 70, { width: 230 });
      doc.text(`Sexo: ${patientGender}`, left, infoTop + 86, { width: 230 });
      doc.text(`Direccion: ${patientAddress}`, left, infoTop + 102, {
        width: 230,
      });
      doc.text(`Entre calles: ${patientBetween}`, left, infoTop + 118, {
        width: 230,
      });

      const doctorX = 300;
      doc.font('Helvetica-Bold').fontSize(11).text('MEDICO', doctorX, infoTop);
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Doctor(a): ${doctorDisplayName}`, doctorX, infoTop + 22, {
        width: 247,
      });
      doc.text(`Cedula: ${doctorLicense}`, doctorX, infoTop + 38, {
        width: 247,
      });
      doc.text(`Especialidad: ${doctorSpecialty}`, doctorX, infoTop + 54, {
        width: 247,
      });
      doc.text(
        `Fecha de toma de muestra: ${sampleDate}`,
        doctorX,
        infoTop + 70,
        {
          width: 247,
        },
      );
      doc.text(
        `Fecha de entrega de resultado: ${deliveryDate}`,
        doctorX,
        infoTop + 86,
        { width: 247 },
      );

      doc.moveTo(left, 272).lineTo(right, 272).strokeColor('#bdbdbd').stroke();

      doc
        .font('Helvetica-Bold')
        .fontSize(12.5)
        .fillColor('#356e93')
        .text(combinedStudyTitle, left, 284, {
          width: right - left,
          align: 'center',
        })
        .fillColor('black');
      doc.moveTo(left, 304).lineTo(right, 304).strokeColor('#bdbdbd').stroke();

      let cursorY = 320;
      for (
        let sectionIndex = 0;
        sectionIndex < sections.length;
        sectionIndex += 1
      ) {
        const section = sections[sectionIndex];
        const groups = this.groupResultValues(
          section.result.values ?? [],
          section.studyDetails,
        );

        if (sectionIndex > 0 && options.studyLayout === 'page-per-study') {
          doc.addPage();
          cursorY = 70;
        } else if (cursorY > pageBottom - 180) {
          doc.addPage();
          cursorY = 70;
        }

        cursorY = drawSectionHeader(section, cursorY);

        if (groups.length === 0) {
          doc.text('Sin parametros visibles para mostrar.', left, cursorY, {
            width: right - left,
          });
          cursorY += 28;
        } else {
          for (
            let groupIndex = 0;
            groupIndex < groups.length;
            groupIndex += 1
          ) {
            const group = groups[groupIndex];

            if (
              options.categoryLayout === 'page-per-category' &&
              groupIndex > 0
            ) {
              cursorY = resetSectionOnNewPage(section);
            } else if (cursorY > pageBottom - 160) {
              cursorY = resetSectionOnNewPage(section);
            }

            cursorY = this.drawResultGroupTitle(
              doc,
              left,
              right,
              cursorY,
              group.title,
            );
            doc.font('Helvetica').fontSize(10);

            for (const value of group.rows) {
              if (cursorY > pageBottom - 140) {
                cursorY = resetSectionOnNewPage(section, group.title);
              }

              doc.text(value.label ?? '', columns.label, cursorY, {
                width: 210,
              });
              doc.text(value.value ?? '', columns.value, cursorY, {
                width: 90,
              });
              doc.text(value.unit ?? '', columns.unit, cursorY, { width: 70 });
              doc.text(value.referenceValue ?? '', columns.ref, cursorY, {
                width: 87,
              });
              cursorY += 18;
            }

            cursorY += 10;
          }
        }

        cursorY += 12;
      }

      let footerY = Math.max(cursorY + 10, pageBottom - footerBlockHeight);
      if (footerY + footerBlockHeight > pageBottom) {
        doc.addPage();
        footerY = doc.page.height - 48 - footerBlockHeight;
      }

      doc
        .moveTo(left, footerY - 10)
        .lineTo(right, footerY - 10)
        .strokeColor('#bdbdbd')
        .stroke();

      if (qrBuffer) {
        doc.image(qrBuffer, left, footerY + 6, { width: 72, height: 72 });
      } else {
        doc
          .rect(left, footerY + 6, 72, 72)
          .strokeColor('#cccccc')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#666666')
          .text('QR', left, footerY + 36, { width: 72, align: 'center' })
          .fillColor('black');
      }
      doc
        .font('Helvetica')
        .fontSize(7)
        .text('ESCANEA QR PARA', left, footerY + 80, {
          width: 72,
          align: 'center',
        });
      doc.text('VALIDAR RESULTADOS', left, footerY + 88, {
        width: 72,
        align: 'center',
      });

      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSchedule, 132, footerY + 12)
        .text(labSampleSchedule, 132, footerY + 28)
        .text(`Correo: ${labEmail}`, 132, footerY + 44)
        .text(`Telefono: ${labPhone}`, 132, footerY + 60);

      if (options.includeSignature) {
        doc
          .font('Helvetica')
          .fontSize(13)
          .text('ATENTAMENTE', signatureX, footerY + 18, {
            width: signatureWidth,
            align: 'right',
          });
        drawImageIfValid(signaturePath, signatureX, footerY + 30, {
          fit: [160, 54],
          align: 'right',
        });
        doc
          .moveTo(signatureX, footerY + 84)
          .lineTo(right, footerY + 84)
          .strokeColor('#202020')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(11)
          .text(responsibleName, signatureX, footerY + 90, {
            width: signatureWidth,
            align: 'right',
          });
        if (responsibleLicense) {
          doc.text(
            `Ced. Prof. ${responsibleLicense}`,
            signatureX,
            footerY + 106,
            {
              width: signatureWidth,
              align: 'right',
            },
          );
        }
        doc
          .font('Helvetica')
          .fontSize(8)
          .text(
            'Este resultado es confidencial y forma parte del expediente clinico.',
            signatureX,
            footerY + 130,
            {
              width: signatureWidth,
              align: 'left',
            },
          );
      } else {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text('Documento emitido sin firma.', signatureX, footerY + 18, {
            width: signatureWidth,
            align: 'right',
          });
        doc
          .font('Helvetica')
          .fontSize(8)
          .text(
            'Este resultado es confidencial y forma parte del expediente clinico.',
            signatureX,
            footerY + 42,
            {
              width: signatureWidth,
              align: 'left',
            },
          );
      }

      doc.end();
    });
  }

  // ---------- Plantilla / borrador ----------

  /**
   * Devuelve un resultado de estudio para un item de servicio.
   * Si no existe aún, crea un borrador vacío tomando los StudyDetail
   * del estudio configurado, para que el front solo llene los RESULTADO.
   * Aqui solo se copian los parametros; las categorias se usan unicamente
   * para organizar la plantilla del estudio.
   *
   * Ideal para la pantalla a la que llegas desde "Acciones -> Resultados".
   */
  async getOrCreateDraftByServiceItem(serviceOrderItemId: number) {
    const existing = await this.resultRepo.findOne({
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

    // Traemos la configuracion activa del estudio.
    const details = await this.detailRepo.find({
      where: { studyId: item.studyId, isActive: true },
      order: { sortOrder: 'ASC' },
    });

    const activeCategoryIds = new Set(
      details
        .filter((detail) => detail.dataType === StudyDetailType.CATEGORY)
        .map((detail) => detail.id),
    );

    // Solo los parametros se capturan en resultados; las categorias funcionan
    // como organizacion de la plantilla en el catalogo del estudio.
    const parameters = details.filter(
      (detail) =>
        detail.dataType === StudyDetailType.PARAMETER &&
        (!detail.parentId || activeCategoryIds.has(detail.parentId)),
    );

    const values = parameters.map((d) =>
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

  async generatePdf(
    id: number,
    rawOptions?: Record<string, string | string[] | undefined>,
  ) {
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
    const studyDetails = await this.detailRepo.find({
      where: {
        studyId: result.serviceOrderItem.studyId,
        isActive: true,
      },
      order: { sortOrder: 'ASC' },
    });
    const options = this.normalizePdfOptions(rawOptions);

    return this.buildPdfBufferWithOptions(result, studyDetails, options);
  }

  async generateServicePdf(
    serviceOrderId: number,
    rawOptions?: Record<string, string | string[] | undefined>,
  ) {
    const service = await this.serviceRepo.findOne({
      where: { id: serviceOrderId, isActive: true },
      relations: {
        patient: true,
        doctor: true,
        items: true,
      },
    });

    if (!service) {
      throw new NotFoundException('Servicio no encontrado.');
    }

    const orderedItems = [...(service.items ?? [])].sort((a, b) => a.id - b.id);
    if (orderedItems.length === 0) {
      throw new NotFoundException(
        'Este servicio no tiene estudios asociados para generar resultados.',
      );
    }

    const detailMap = await this.getStudyDetailsMap(
      orderedItems.map((item) => item.studyId),
    );
    const options = this.normalizePdfOptions(rawOptions);
    const sections: ResultPdfSection[] = [];

    for (const item of orderedItems) {
      const result = await this.getOrCreateDraftByServiceItem(item.id);
      sections.push({
        result,
        studyName: item.studyNameSnapshot,
        packageName: item.sourcePackageNameSnapshot,
        studyDetails: detailMap.get(item.studyId) ?? [],
      });
    }

    return this.buildServicePdfBufferWithOptions(service, sections, options);
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
      throw new NotFoundException(
        'El servicio clínico no existe o está inactivo.',
      );
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

    if (dto.serviceOrderId && dto.serviceOrderId !== result.serviceOrderId) {
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
