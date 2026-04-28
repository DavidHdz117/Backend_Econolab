import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument = require('pdfkit');
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as QRCode from 'qrcode';
import { buildPersonName, formatAgeLabel } from '../common/utils/person.util';
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
import {
  buildLabResultUrl,
  labConfig,
  type LabRuntimeConfig,
} from '../config/lab.config';
import { RuntimePolicyService } from '../runtime/runtime-policy.service';
import { normalizeCompactSearchText } from '../common/utils/search-normalization.util';

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
    private readonly configService: ConfigService,
    private readonly runtimePolicy: RuntimePolicyService,
  ) {}

  // ---------- Helpers ----------

  private getLabRuntimeConfig() {
    return this.configService.getOrThrow<LabRuntimeConfig>('lab');
  }

  private getLabResultsDocumentConfig() {
    const lab = this.getLabRuntimeConfig();

    return {
      name: lab.name,
      subtitle: lab.subtitle,
      address: lab.address || 'Direccion no configurada',
      addressLine2: lab.addressLine2,
      phone: lab.phone || 'Telefono no configurado',
      email: lab.email || 'Correo no configurado',
      schedule: lab.schedule || 'Horario no configurado',
      sampleSchedule: lab.sampleSchedule || 'Horario de toma no configurado',
      logoPath: lab.logoPath ?? '',
      signaturePath: lab.signaturePath ?? '',
      responsibleName: lab.responsibleName,
      responsibleLicense: lab.responsibleLicense,
    };
  }

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
      publicId: dto.publicId ?? null,
      studyDetailId: dto.studyDetailId ?? studyDetail?.id,
      label: baseLabel,
      unit: baseUnit,
      referenceValue: baseRef,
      value: dto.value,
      sortOrder: dto.sortOrder,
      visible: dto.visible,
    });
  }

  private async findStudyDetailById(studyDetailId?: number) {
    if (!studyDetailId) {
      return undefined;
    }

    const detail = await this.detailRepo.findOne({
      where: { id: studyDetailId },
    });

    return detail ?? undefined;
  }

  private async mapValueDtosToEntities(dtos: StudyResultValueDto[]) {
    const details = await Promise.all(
      dtos.map((dto) => this.findStudyDetailById(dto.studyDetailId)),
    );

    return dtos.map((dto, index) =>
      this.mapValueDtoToEntity(dto, details[index]),
    );
  }

  private getResultValueIdentityKey(
    value: Pick<StudyResultValue, 'studyDetailId' | 'label'>,
  ) {
    if (value.studyDetailId) {
      return `detail:${value.studyDetailId}`;
    }

    return `label:${normalizeCompactSearchText(value.label)}`;
  }

  private reconcileResultValues(
    existingValues: StudyResultValue[],
    preparedValues: StudyResultValue[],
  ) {
    const existingByPublicId = new Map(
      existingValues
        .filter((value) => Boolean(value.publicId))
        .map((value) => [value.publicId!, value] as const),
    );
    const existingBuckets = new Map<string, StudyResultValue[]>();
    const usedValueIds = new Set<number>();

    for (const value of [...existingValues].sort((a, b) => a.id - b.id)) {
      const key = this.getResultValueIdentityKey(value);
      const bucket = existingBuckets.get(key) ?? [];
      bucket.push(value);
      existingBuckets.set(key, bucket);
    }

    const takeNextBucketMatch = (preparedValue: StudyResultValue) => {
      const key = this.getResultValueIdentityKey(preparedValue);
      const bucket = existingBuckets.get(key) ?? [];

      while (bucket.length > 0) {
        const candidate = bucket.shift()!;
        if (!usedValueIds.has(candidate.id)) {
          return candidate;
        }
      }

      return undefined;
    };

    const values = preparedValues.map((preparedValue) => {
      let matched =
        (preparedValue.publicId
          ? existingByPublicId.get(preparedValue.publicId)
          : undefined) ?? takeNextBucketMatch(preparedValue);

      if (matched && usedValueIds.has(matched.id)) {
        matched = takeNextBucketMatch(preparedValue);
      }

      if (!matched) {
        return preparedValue;
      }

      usedValueIds.add(matched.id);

      return this.valueRepo.merge(matched, {
        ...preparedValue,
        publicId: matched.publicId ?? preparedValue.publicId ?? null,
        deletedAt: null,
      });
    });

    const removedValueIds = existingValues
      .filter((value) => !usedValueIds.has(value.id))
      .map((value) => value.id);

    return { values, removedValueIds };
  }

  private findActiveResultByServiceItem(serviceOrderItemId: number) {
    return this.resultRepo.findOne({
      where: { serviceOrderItemId, isActive: true },
    });
  }

  private async buildQrBuffer(result: StudyResult): Promise<Buffer | null> {
    const finalUrl = buildLabResultUrl(this.getLabRuntimeConfig(), result.id);
    if (!finalUrl) return null;

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

  private drawCenteredResultHeading(
    doc: ResultPdfDoc,
    left: number,
    right: number,
    y: number,
    text: string,
    fontSize = 12.5,
  ) {
    const normalizedText = text.trim() || 'RESULTADOS';

    doc.font('Helvetica-Bold').fontSize(fontSize);
    const height = doc.heightOfString(normalizedText, {
      width: right - left,
      align: 'center',
    });

    doc
      .fillColor('#356e93')
      .text(normalizedText, left, y, {
        width: right - left,
        align: 'center',
      })
      .fillColor('black');

    return height;
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

      const lab = this.getLabResultsDocumentConfig();
      const labName = lab.name;
      const labSubtitle = lab.subtitle;
      const labAddress = lab.address;
      const labAddress2 = lab.addressLine2;
      const labPhone = lab.phone;
      const labEmail = lab.email;
      const labSchedule = lab.schedule;
      const labSampleSchedule = lab.sampleSchedule;
      const logoPath = lab.logoPath;
      const signaturePath = lab.signaturePath;
      const responsibleName = lab.responsibleName;
      const responsibleLicense = lab.responsibleLicense;

      const service = result.serviceOrder;
      const patient = service?.patient;
      const doctor = service?.doctor;
      const studyName = result.serviceOrderItem?.studyNameSnapshot ?? '';
      const groups = this.groupResultValues(result.values ?? [], studyDetails);
      const left = 48;
      const right = doc.page.width - left;
      const pageBottom = doc.page.height - 48;
      const headerY = 48;
      const logoBox = { x: left, y: headerY + 4, w: 132, h: 42 };
      const headerTitleX = 194;
      const headerTitleWidth = 186;
      const headerMetaX = 390;
      const columns: ResultPdfColumns = {
        label: left,
        value: 280,
        unit: 380,
        ref: 460,
      };
      const signatureWidth = 187;
      const signatureX = right - signatureWidth;
      const footerBlockHeight = options.includeSignature ? 150 : 110;

      const patientName = buildPersonName(
        patient?.firstName,
        patient?.lastName,
        patient?.middleName,
      );
      const doctorName = buildPersonName(
        doctor?.firstName,
        doctor?.lastName,
        doctor?.middleName,
      );
      const doctorDisplayName = doctorName || 'A QUIEN CORRESPONDA';
      const patientBirthDate = this.formatBirthDateLabel(patient?.birthDate);
      const patientAge = this.displayText(
        formatAgeLabel(patient?.birthDate, ''),
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
        .text(labName, headerTitleX, headerY - 2, {
          width: headerTitleWidth,
          align: 'center',
        });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSubtitle, headerTitleX, headerY + 22, {
          width: headerTitleWidth,
          align: 'center',
        });
      doc.text(labAddress, headerTitleX, headerY + 34, {
        width: headerTitleWidth,
        align: 'center',
      });
      if (labAddress2) {
        doc.text(labAddress2, headerTitleX, headerY + 46, {
          width: headerTitleWidth,
          align: 'center',
        });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(
          `SUC: ${this.displayText(service?.branchName)}`,
          headerMetaX,
          headerY,
          {
            width: right - headerMetaX,
            align: 'right',
          },
        );
      doc.text(
        `FOLIO: ${this.displayText(service?.folio)}`,
        headerMetaX,
        headerY + 20,
        {
          width: right - headerMetaX,
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

      const studyTitleY = 282;
      const studyTitleHeight = this.drawCenteredResultHeading(
        doc,
        left,
        right,
        studyTitleY,
        `ESTUDIO: ${studyName}`,
        13,
      );
      let tableY = studyTitleY + studyTitleHeight + 12;

      if (result.method) {
        const methodLabel = `Metodo: ${result.method}`;
        doc.font('Helvetica').fontSize(9);
        doc.text(methodLabel, left, tableY - 8, {
          width: right - left,
          align: 'center',
        });
        const methodHeight = doc.heightOfString(methodLabel, {
          width: right - left,
          align: 'center',
        });
        tableY += methodHeight + 4;
      }

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

      const lab = this.getLabResultsDocumentConfig();
      const labName = lab.name;
      const labSubtitle = lab.subtitle;
      const labAddress = lab.address;
      const labAddress2 = lab.addressLine2;
      const labPhone = lab.phone;
      const labEmail = lab.email;
      const labSchedule = lab.schedule;
      const labSampleSchedule = lab.sampleSchedule;
      const logoPath = lab.logoPath;
      const signaturePath = lab.signaturePath;
      const responsibleName = lab.responsibleName;
      const responsibleLicense = lab.responsibleLicense;

      const patient = service.patient;
      const doctor = service.doctor;
      const left = 48;
      const right = doc.page.width - left;
      const pageBottom = doc.page.height - 48;
      const headerY = 48;
      const logoBox = { x: left, y: headerY + 4, w: 132, h: 42 };
      const headerTitleX = 194;
      const headerTitleWidth = 186;
      const headerMetaX = 390;
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

      const patientName = buildPersonName(
        patient?.firstName,
        patient?.lastName,
        patient?.middleName,
      );
      const doctorName = buildPersonName(
        doctor?.firstName,
        doctor?.lastName,
        doctor?.middleName,
      );
      const doctorDisplayName = doctorName || 'A QUIEN CORRESPONDA';
      const patientBirthDate = this.formatBirthDateLabel(patient?.birthDate);
      const patientAge = this.displayText(
        formatAgeLabel(patient?.birthDate, ''),
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
          const sectionTitle = sectionLabel(section);
          doc
            .font('Helvetica-Bold')
            .fontSize(12)
            .text(sectionTitle, left, nextY, {
              width: right - left,
              align: 'center',
            });
          nextY +=
            doc.heightOfString(sectionTitle, {
              width: right - left,
              align: 'center',
            }) + 6;
        }

        if (section.result.method) {
          const methodLabel = `Metodo: ${section.result.method}`;
          doc
            .font('Helvetica')
            .fontSize(9)
            .text(methodLabel, left, nextY, {
              width: right - left,
              align: 'center',
            });
          nextY +=
            doc.heightOfString(methodLabel, {
              width: right - left,
              align: 'center',
            }) + 6;
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
        .text(labName, headerTitleX, headerY - 2, {
          width: headerTitleWidth,
          align: 'center',
        });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSubtitle, headerTitleX, headerY + 22, {
          width: headerTitleWidth,
          align: 'center',
        });
      doc.text(labAddress, headerTitleX, headerY + 34, {
        width: headerTitleWidth,
        align: 'center',
      });
      if (labAddress2) {
        doc.text(labAddress2, headerTitleX, headerY + 46, {
          width: headerTitleWidth,
          align: 'center',
        });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(`SUC: ${this.displayText(service.branchName)}`, headerMetaX, headerY, {
          width: right - headerMetaX,
          align: 'right',
        });
      doc.text(`FOLIO: ${this.displayText(service.folio)}`, headerMetaX, headerY + 20, {
        width: right - headerMetaX,
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

      const combinedTitleY = 284;
      const combinedTitleHeight = this.drawCenteredResultHeading(
        doc,
        left,
        right,
        combinedTitleY,
        combinedStudyTitle,
      );
      const combinedTitleDividerY = combinedTitleY + combinedTitleHeight + 8;
      doc
        .moveTo(left, combinedTitleDividerY)
        .lineTo(right, combinedTitleDividerY)
        .strokeColor('#bdbdbd')
        .stroke();

      let cursorY = combinedTitleDividerY + 16;
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
    const existing =
      await this.findActiveResultByServiceItem(serviceOrderItemId);
    if (existing) {
      return existing;
    }

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

    const existing = await this.findActiveResultByServiceItem(
      dto.serviceOrderItemId,
    );
    if (existing) {
      throw new BadRequestException(
        'Ya existen resultados registrados para este estudio. Utiliza la edición.',
      );
    }

    const values = await this.mapValueDtosToEntities(dto.values);

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
    let removedValueIds: number[] = [];

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
      const preparedValues = await this.mapValueDtosToEntities(dto.values);
      const reconciliation = this.reconcileResultValues(
        result.values ?? [],
        preparedValues,
      );
      result.values = reconciliation.values;
      removedValueIds = reconciliation.removedValueIds;
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

    const savedId = await this.resultRepo.manager.transaction(
      async (manager) => {
        const transactionalResultRepo = manager.getRepository(StudyResult);
        const transactionalValueRepo = manager.getRepository(StudyResultValue);
        const saved = await transactionalResultRepo.save(result);

        if (removedValueIds.length > 0) {
          const removedValues = result.values.filter((value) =>
            removedValueIds.includes(value.id),
          );
          await transactionalValueRepo.remove(removedValues);
        }

        return saved.id;
      },
    );

    return this.findOne(savedId);
  }

  async softDelete(id: number) {
    const result = await this.findOne(id);
    result.isActive = false;
    result.deletedAt = new Date();
    await this.resultRepo.save(result);
    return { message: 'Resultado desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    this.runtimePolicy.assertHardDeleteAllowed('resultados');
    const result = await this.findOne(id);
    await this.resultRepo.remove(result);
    return { message: 'Resultado eliminado definitivamente.' };
  }
}
