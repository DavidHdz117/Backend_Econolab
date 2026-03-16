import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ServiceOrder,
  ServiceStatus,
} from '../services/entities/service-order.entity';
import {
  DailyClosing,
  type DailyClosingBranchSnapshot,
  type DailyClosingHourSnapshot,
  type DailyClosingServiceSnapshot,
  type DailyClosingStudySnapshot,
} from './entities/daily-closing.entity';

@Injectable()
export class HistoryService {
  private readonly labTimeZone = 'America/Mexico_City';
  private readonly labTimeZoneOffset = '-06:00';

  constructor(
    @InjectRepository(ServiceOrder)
    private readonly serviceRepo: Repository<ServiceOrder>,
    @InjectRepository(DailyClosing)
    private readonly dailyClosingRepo: Repository<DailyClosing>,
  ) {}

  private toNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private normalizeSearchText(value?: string | null) {
    if (!value) return '';

    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .toLowerCase()
      .trim();
  }

  private sqlNormalizedExpression(expression: string) {
    return `regexp_replace(translate(lower(coalesce(${expression}, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'), '[^a-z0-9]+', '', 'g')`;
  }

  private formatDateForInput(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getLabDateInput(value = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.labTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(value);
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    return `${year}-${month}-${day}`;
  }

  private getLabHourLabel(value?: Date | null) {
    if (!value) return 'Sin hora';

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.labTimeZone,
      hour: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(value);
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    return `${hour}:00`;
  }

  private getDayBounds(dateInput?: string) {
    const selectedDate =
      dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
        ? dateInput
        : this.getLabDateInput();
    const start = new Date(
      `${selectedDate}T00:00:00.000${this.labTimeZoneOffset}`,
    );
    const end = new Date(
      `${selectedDate}T23:59:59.999${this.labTimeZoneOffset}`,
    );

    return {
      selectedDate,
      start,
      end,
    };
  }

  private getCompletedMoment(service: ServiceOrder) {
    return service.completedAt ?? service.updatedAt ?? service.createdAt;
  }

  private summarizeStudies(service: ServiceOrder) {
    const packageGroups = new Map<string, string[]>();
    const standaloneStudies: string[] = [];

    for (const item of service.items ?? []) {
      if (item.sourcePackageNameSnapshot) {
        const current = packageGroups.get(item.sourcePackageNameSnapshot) ?? [];
        current.push(item.studyNameSnapshot);
        packageGroups.set(item.sourcePackageNameSnapshot, current);
        continue;
      }

      standaloneStudies.push(item.studyNameSnapshot);
    }

    return [
      ...[...packageGroups.entries()].map(
        ([packageName, studies]) => `${packageName}: ${studies.join(', ')}`,
      ),
      ...standaloneStudies,
    ].join(' | ');
  }

  private mapServiceSnapshot(service: ServiceOrder): DailyClosingServiceSnapshot {
    const patientName = service.patient
      ? `${service.patient.firstName} ${service.patient.lastName} ${service.patient.middleName ?? ''}`.trim()
      : 'Sin paciente';

    return {
      serviceId: service.id,
      folio: service.folio,
      patientName,
      studySummary: this.summarizeStudies(service),
      branchName: service.branchName ?? 'Sin sucursal',
      completedAt: this.getCompletedMoment(service)?.toISOString() ?? null,
      createdAt: service.createdAt?.toISOString() ?? null,
      deliveryAt: service.deliveryAt?.toISOString() ?? null,
      subtotalAmount: this.toNumber(service.subtotalAmount),
      discountAmount: this.toNumber(service.discountAmount),
      totalAmount: this.toNumber(service.totalAmount),
    };
  }

  private buildSummary(services: ServiceOrder[]) {
    const serviceSnapshots = services.map((service) =>
      this.mapServiceSnapshot(service),
    );
    const patientsCount = new Set(services.map((service) => service.patientId))
      .size;
    const studiesCount = services.reduce(
      (acc, service) => acc + (service.items?.length ?? 0),
      0,
    );
    const subtotalAmount = services.reduce(
      (acc, service) => acc + this.toNumber(service.subtotalAmount),
      0,
    );
    const discountAmount = services.reduce(
      (acc, service) => acc + this.toNumber(service.discountAmount),
      0,
    );
    const totalAmount = services.reduce(
      (acc, service) => acc + this.toNumber(service.totalAmount),
      0,
    );
    const averageTicket = services.length > 0 ? totalAmount / services.length : 0;

    const branchAccumulator = new Map<
      string,
      { branchName: string; servicesCount: number; revenueTotal: number }
    >();
    const studyAccumulator = new Map<string, number>();
    const hourAccumulator = new Map<
      string,
      { hour: string; servicesCount: number; revenueTotal: number }
    >();

    for (const service of services) {
      const branchName = service.branchName ?? 'Sin sucursal';
      const branchEntry = branchAccumulator.get(branchName) ?? {
        branchName,
        servicesCount: 0,
        revenueTotal: 0,
      };
      branchEntry.servicesCount += 1;
      branchEntry.revenueTotal += this.toNumber(service.totalAmount);
      branchAccumulator.set(branchName, branchEntry);

      for (const item of service.items ?? []) {
        const studyName = item.studyNameSnapshot ?? 'Sin estudio';
        studyAccumulator.set(studyName, (studyAccumulator.get(studyName) ?? 0) + 1);
      }

      const completedMoment = this.getCompletedMoment(service);
      const hourLabel = this.getLabHourLabel(completedMoment);
      const hourEntry = hourAccumulator.get(hourLabel) ?? {
        hour: hourLabel,
        servicesCount: 0,
        revenueTotal: 0,
      };
      hourEntry.servicesCount += 1;
      hourEntry.revenueTotal += this.toNumber(service.totalAmount);
      hourAccumulator.set(hourLabel, hourEntry);
    }

    const branchBreakdown: DailyClosingBranchSnapshot[] = [
      ...branchAccumulator.values(),
    ].sort((a, b) => b.revenueTotal - a.revenueTotal);

    const topStudies: DailyClosingStudySnapshot[] = [...studyAccumulator.entries()]
      .map(([studyName, times]) => ({ studyName, times }))
      .sort((a, b) => b.times - a.times)
      .slice(0, 8);

    const hourlyBreakdown: DailyClosingHourSnapshot[] = [
      ...hourAccumulator.values(),
    ].sort((a, b) => a.hour.localeCompare(b.hour));

    return {
      servicesCount: services.length,
      patientsCount,
      studiesCount,
      subtotalAmount,
      discountAmount,
      totalAmount,
      averageTicket,
      branchBreakdown,
      topStudies,
      hourlyBreakdown,
      servicesSnapshot: serviceSnapshots,
    };
  }

  private mapDailyClosing(entity: DailyClosing, includeSnapshot = false) {
    return {
      id: entity.id,
      closingDate: entity.closingDate,
      periodStart: entity.periodStart,
      periodEnd: entity.periodEnd,
      servicesCount: entity.servicesCount,
      patientsCount: entity.patientsCount,
      studiesCount: entity.studiesCount,
      subtotalAmount: this.toNumber(entity.subtotalAmount),
      discountAmount: this.toNumber(entity.discountAmount),
      totalAmount: this.toNumber(entity.totalAmount),
      averageTicket: this.toNumber(entity.averageTicket),
      branchBreakdown: entity.branchBreakdown ?? [],
      topStudies: entity.topStudies ?? [],
      hourlyBreakdown: entity.hourlyBreakdown ?? [],
      servicesSnapshot: includeSnapshot ? entity.servicesSnapshot ?? [] : [],
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private async getCompletedServicesForDate(date: string, search?: string) {
    const normalizedSearch = this.normalizeSearchText(search);
    const completedAtExpr = `coalesce(s.completedAt, s.updatedAt, s.createdAt)`;
    const labDateExpr = `date(timezone('${this.labTimeZone}', ${completedAtExpr}))`;
    const completedSortAlias = 'history_completed_sort';

    const qb = this.serviceRepo
      .createQueryBuilder('s')
      .addSelect(completedAtExpr, completedSortAlias)
      .leftJoinAndSelect('s.patient', 'p')
      .leftJoinAndSelect('s.doctor', 'd')
      .leftJoinAndSelect('s.items', 'i')
      .where('s.isActive = :active', { active: true })
      .andWhere('s.status = :status', { status: ServiceStatus.COMPLETED })
      .andWhere(`${labDateExpr} = :selectedDate`, { selectedDate: date })
      .distinct(true);

    if (normalizedSearch) {
      qb.andWhere(
        `(
          ${this.sqlNormalizedExpression('s.folio')} LIKE :normalizedSearch
          OR ${this.sqlNormalizedExpression(
            "concat_ws(' ', p.firstName, p.lastName, p.middleName)",
          )} LIKE :normalizedSearch
          OR ${this.sqlNormalizedExpression('i.studyNameSnapshot')} LIKE :normalizedSearch
        )`,
        { normalizedSearch: `%${normalizedSearch}%` },
      );
    }

    qb.orderBy(completedSortAlias, 'DESC');

    return qb.getMany();
  }

  async getDashboard(date?: string, search?: string) {
    const { selectedDate } = this.getDayBounds(date);
    const services = await this.getCompletedServicesForDate(selectedDate, search);
    const summary = this.buildSummary(services);

    const savedCut = await this.dailyClosingRepo.findOne({
      where: { closingDate: selectedDate },
    });

    const recentCuts = await this.dailyClosingRepo.find({
      order: { closingDate: 'DESC' },
      take: 45,
    });

    return {
      selectedDate,
      services: services.map((service) => ({
        id: service.id,
        folio: service.folio,
        paciente: service.patient
          ? `${service.patient.firstName} ${service.patient.lastName} ${service.patient.middleName ?? ''}`.trim()
          : 'Sin paciente',
        telefono: service.patient?.phone ?? '-',
        estudio: this.summarizeStudies(service),
        sucursal: service.branchName ?? 'Sin sucursal',
        fechaCreacion: service.createdAt,
        fechaEntrega: service.deliveryAt,
        fechaConclusion: this.getCompletedMoment(service),
        subtotalAmount: this.toNumber(service.subtotalAmount),
        discountAmount: this.toNumber(service.discountAmount),
        totalAmount: this.toNumber(service.totalAmount),
        status: service.status,
      })),
      summary,
      savedCut: savedCut ? this.mapDailyClosing(savedCut) : null,
      recentCuts: recentCuts.map((cut) => this.mapDailyClosing(cut)),
    };
  }

  async generateDailyCut(date?: string) {
    const { selectedDate, start, end } = this.getDayBounds(date);
    const services = await this.getCompletedServicesForDate(selectedDate);
    const summary = this.buildSummary(services);

    const existing = await this.dailyClosingRepo.findOne({
      where: { closingDate: selectedDate },
    });

    const entity = this.dailyClosingRepo.create({
      id: existing?.id,
      closingDate: selectedDate,
      periodStart: start,
      periodEnd: end,
      servicesCount: summary.servicesCount,
      patientsCount: summary.patientsCount,
      studiesCount: summary.studiesCount,
      subtotalAmount: summary.subtotalAmount,
      discountAmount: summary.discountAmount,
      totalAmount: summary.totalAmount,
      averageTicket: summary.averageTicket,
      branchBreakdown: summary.branchBreakdown,
      topStudies: summary.topStudies,
      hourlyBreakdown: summary.hourlyBreakdown,
      servicesSnapshot: summary.servicesSnapshot,
    });

    const saved = await this.dailyClosingRepo.save(entity);
    return this.mapDailyClosing(saved);
  }

  async exportDailyCutCsv(id: number) {
    const closing = await this.dailyClosingRepo.findOne({ where: { id } });
    if (!closing) {
      throw new NotFoundException('No se encontro el corte solicitado.');
    }

    const summary = this.mapDailyClosing(closing, true);
    const escapeCsv = (value: string | number | null | undefined) => {
      const raw = value == null ? '' : String(value);
      return `"${raw.replace(/"/g, '""')}"`;
    };

    const lines: string[] = [];
    lines.push('\uFEFFCorte del dia');
    lines.push(
      [
        'Fecha',
        'Servicios',
        'Pacientes',
        'Estudios',
        'Subtotal',
        'Descuento',
        'Total',
        'Ticket promedio',
      ].join(','),
    );
    lines.push(
      [
        escapeCsv(summary.closingDate),
        summary.servicesCount,
        summary.patientsCount,
        summary.studiesCount,
        summary.subtotalAmount.toFixed(2),
        summary.discountAmount.toFixed(2),
        summary.totalAmount.toFixed(2),
        summary.averageTicket.toFixed(2),
      ].join(','),
    );
    lines.push('');
    lines.push('Detalle de servicios');
    lines.push(
      [
        'Folio',
        'Paciente',
        'Estudios',
        'Sucursal',
        'Conclusion',
        'Creacion',
        'Entrega',
        'Subtotal',
        'Descuento',
        'Total',
      ].join(','),
    );

    for (const item of summary.servicesSnapshot) {
      lines.push(
        [
          escapeCsv(item.folio),
          escapeCsv(item.patientName),
          escapeCsv(item.studySummary),
          escapeCsv(item.branchName),
          escapeCsv(item.completedAt ?? ''),
          escapeCsv(item.createdAt ?? ''),
          escapeCsv(item.deliveryAt ?? ''),
          item.subtotalAmount.toFixed(2),
          item.discountAmount.toFixed(2),
          item.totalAmount.toFixed(2),
        ].join(','),
      );
    }

    lines.push('');
    lines.push('Desglose por sucursal');
    lines.push(['Sucursal', 'Servicios', 'Total'].join(','));
    for (const branch of summary.branchBreakdown) {
      lines.push(
        [
          escapeCsv(branch.branchName),
          branch.servicesCount,
          branch.revenueTotal.toFixed(2),
        ].join(','),
      );
    }

    lines.push('');
    lines.push('Estudios mas frecuentes');
    lines.push(['Estudio', 'Veces'].join(','));
    for (const study of summary.topStudies) {
      lines.push([escapeCsv(study.studyName), study.times].join(','));
    }

    return Buffer.from(lines.join('\n'), 'utf-8');
  }
}
