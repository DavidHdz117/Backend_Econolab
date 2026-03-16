import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLoginLog } from '../auth/entities/user-login-log.entity';
import { Role } from '../common/enums/roles.enum';
import { DailyClosing } from '../history/entities/daily-closing.entity';
import {
  ServiceOrder,
  ServiceStatus,
} from '../services/entities/service-order.entity';
import { User } from '../users/entities/user.entity';

type DashboardRange = 'today' | '7d' | '30d' | '90d' | 'year' | 'custom';
type DashboardRoleFilter = 'all' | 'admin' | 'recepcionista';
type TrendGrouping = 'day' | 'month';

@Injectable()
export class DashboardService {
  private readonly labTimeZone = 'America/Mexico_City';

  constructor(
    @InjectRepository(ServiceOrder)
    private readonly serviceRepo: Repository<ServiceOrder>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserLoginLog)
    private readonly loginLogRepo: Repository<UserLoginLog>,
    @InjectRepository(DailyClosing)
    private readonly dailyClosingRepo: Repository<DailyClosing>,
  ) {}

  private toNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
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

  private getLocalDateExpression(expression: string) {
    return `date(timezone('${this.labTimeZone}', ${expression}))`;
  }

  private getMonthKey(value: Date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.labTimeZone,
      year: 'numeric',
      month: '2-digit',
    });
    const parts = formatter.formatToParts(value);
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    return `${year}-${month}`;
  }

  private parseDateInput(value?: string): string | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;

    return value;
  }

  private getDateDistanceInDays(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const diff = end.getTime() - start.getTime();
    return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000))) + 1;
  }

  private getRangeConfig(
    rangeInput?: string,
    startDateInput?: string,
    endDateInput?: string,
  ) {
    const allowed: DashboardRange[] = ['today', '7d', '30d', '90d', 'year', 'custom'];
    const requestedRange = allowed.includes(rangeInput as DashboardRange)
      ? (rangeInput as DashboardRange)
      : 'today';
    const today = new Date();
    const end = new Date(today);
    const start = new Date(today);

    if (requestedRange === '7d') {
      start.setDate(start.getDate() - 6);
    } else if (requestedRange === '30d') {
      start.setDate(start.getDate() - 29);
    } else if (requestedRange === '90d') {
      start.setDate(start.getDate() - 89);
    } else if (requestedRange === 'year') {
      start.setDate(start.getDate() - 364);
    }

    const customStart = this.parseDateInput(startDateInput);
    const customEnd = this.parseDateInput(endDateInput);

    if (requestedRange === 'custom' && customStart && customEnd) {
      const normalizedStart = customStart <= customEnd ? customStart : customEnd;
      const normalizedEnd = customStart <= customEnd ? customEnd : customStart;
      const spanDays = this.getDateDistanceInDays(normalizedStart, normalizedEnd);

      return {
        range: 'custom' as const,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        label: 'Rango personalizado',
        trendGrouping: spanDays > 120 ? ('month' as const) : ('day' as const),
      };
    }

    const range = requestedRange === 'custom' ? 'today' : requestedRange;
    const startDate = range === 'today' ? this.getLabDateInput(end) : this.getLabDateInput(start);
    const endDate = this.getLabDateInput(end);

    const labels: Record<Exclude<DashboardRange, 'custom'>, string> = {
      today: 'Hoy',
      '7d': 'Ultimos 7 dias',
      '30d': 'Ultimos 30 dias',
      '90d': 'Ultimos 3 meses',
      year: 'Ultimo año',
    };

    return {
      range,
      startDate,
      endDate,
      label: labels[range],
      trendGrouping: range === 'year' ? ('month' as const) : ('day' as const),
    };
  }

  private getRoleFilter(roleInput?: string): DashboardRoleFilter {
    return roleInput === 'admin' || roleInput === 'recepcionista' ? roleInput : 'all';
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

  private buildStudyRanking(services: ServiceOrder[]) {
    const counts = new Map<string, number>();

    for (const service of services) {
      for (const item of service.items ?? []) {
        const studyName = item.studyNameSnapshot ?? 'Sin estudio';
        counts.set(studyName, (counts.get(studyName) ?? 0) + 1);
      }
    }

    const ranked = [...counts.entries()]
      .map(([studyName, times]) => ({ studyName, times }))
      .sort((a, b) => b.times - a.times || a.studyName.localeCompare(b.studyName));

    return {
      ranked,
      top: ranked[0] ?? null,
      bottom: ranked.length > 0 ? ranked[ranked.length - 1] : null,
    };
  }

  private buildBranchSummary(services: ServiceOrder[]) {
    const branches = new Map<
      string,
      { branchName: string; servicesCount: number; revenueTotal: number }
    >();

    for (const service of services) {
      const branchName = service.branchName ?? 'Sin sucursal';
      const current = branches.get(branchName) ?? {
        branchName,
        servicesCount: 0,
        revenueTotal: 0,
      };
      current.servicesCount += 1;
      current.revenueTotal += this.toNumber(service.totalAmount);
      branches.set(branchName, current);
    }

    return [...branches.values()].sort((a, b) => b.revenueTotal - a.revenueTotal);
  }

  private buildTrend(services: ServiceOrder[], grouping: TrendGrouping) {
    const buckets = new Map<
      string,
      { key: string; revenueTotal: number; servicesCount: number }
    >();

    for (const service of services) {
      const completedAt = service.completedAt ?? service.updatedAt ?? service.createdAt ?? new Date();
      const key =
        grouping === 'month'
          ? this.getMonthKey(completedAt)
          : this.getLabDateInput(completedAt);
      const current = buckets.get(key) ?? {
        key,
        revenueTotal: 0,
        servicesCount: 0,
      };
      current.revenueTotal += this.toNumber(service.totalAmount);
      current.servicesCount += 1;
      buckets.set(key, current);
    }

    return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async getOverview(
    rangeInput?: string,
    roleInput?: string,
    startDateInput?: string,
    endDateInput?: string,
  ) {
    const rangeConfig = this.getRangeConfig(rangeInput, startDateInput, endDateInput);
    const roleFilter = this.getRoleFilter(roleInput);
    const createdLocalDateExpr = this.getLocalDateExpression('s.createdAt');
    const completedLocalDateExpr = this.getLocalDateExpression(
      'coalesce(s.completedAt, s.updatedAt, s.createdAt)',
    );
    const loginLocalDateExpr = this.getLocalDateExpression('log.created_at');

    const [
      createdServicesInRange,
      completedServicesInRange,
      pendingCount,
      inProgressCount,
      cancelledInRangeCount,
      users,
      rangeLoginLogs,
      recentLoginLogs,
      savedTodayCut,
    ] = await Promise.all([
      this.serviceRepo
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.patient', 'p')
        .leftJoinAndSelect('s.items', 'i')
        .where('s.isActive = :active', { active: true })
        .andWhere(`${createdLocalDateExpr} >= :startDate`, {
          startDate: rangeConfig.startDate,
        })
        .andWhere(`${createdLocalDateExpr} <= :endDate`, {
          endDate: rangeConfig.endDate,
        })
        .orderBy('s.createdAt', 'DESC')
        .getMany(),
      this.serviceRepo
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.patient', 'p')
        .leftJoinAndSelect('s.items', 'i')
        .where('s.isActive = :active', { active: true })
        .andWhere('s.status = :status', { status: ServiceStatus.COMPLETED })
        .andWhere(`${completedLocalDateExpr} >= :startDate`, {
          startDate: rangeConfig.startDate,
        })
        .andWhere(`${completedLocalDateExpr} <= :endDate`, {
          endDate: rangeConfig.endDate,
        })
        .orderBy('coalesce(s.completedAt, s.updatedAt, s.createdAt)', 'DESC')
        .getMany(),
      this.serviceRepo.count({
        where: { isActive: true, status: ServiceStatus.PENDING },
      }),
      this.serviceRepo.count({
        where: { isActive: true, status: ServiceStatus.IN_PROGRESS },
      }),
      this.serviceRepo
        .createQueryBuilder('s')
        .where('s.isActive = :active', { active: true })
        .andWhere('s.status = :status', { status: ServiceStatus.CANCELLED })
        .andWhere(`${createdLocalDateExpr} >= :startDate`, {
          startDate: rangeConfig.startDate,
        })
        .andWhere(`${createdLocalDateExpr} <= :endDate`, {
          endDate: rangeConfig.endDate,
        })
        .getCount(),
      this.userRepo.find({
        where: [{ confirmed: true, rol: Role.Admin }, { confirmed: true, rol: Role.Recepcionista }],
        order: { nombre: 'ASC' },
      }),
      this.loginLogRepo
        .createQueryBuilder('log')
        .leftJoinAndSelect('log.user', 'u')
        .where(`${loginLocalDateExpr} >= :startDate`, {
          startDate: rangeConfig.startDate,
        })
        .andWhere(`${loginLocalDateExpr} <= :endDate`, {
          endDate: rangeConfig.endDate,
        })
        .orderBy('log.createdAt', 'DESC')
        .getMany(),
      this.loginLogRepo.find({
        relations: ['user'],
        order: { createdAt: 'DESC' },
        take: 12,
      }),
      this.dailyClosingRepo.findOne({ where: { closingDate: this.getLabDateInput() } }),
    ]);

    const revenueInRange = completedServicesInRange.reduce(
      (acc, service) => acc + this.toNumber(service.totalAmount),
      0,
    );
    const averageTicket =
      completedServicesInRange.length > 0
        ? revenueInRange / completedServicesInRange.length
        : 0;
    const studyRanking = this.buildStudyRanking(createdServicesInRange);
    const branchSummary = this.buildBranchSummary(completedServicesInRange);
    const trend = this.buildTrend(
      completedServicesInRange,
      rangeConfig.trendGrouping,
    );

    const successfulLogins = rangeLoginLogs.filter((log) => log.success);
    const failedLogins = rangeLoginLogs.filter((log) => !log.success);
    const uniqueUsers = new Set(
      successfulLogins
        .map((log) => log.user?.id)
        .filter((value): value is string => Boolean(value)),
    ).size;

    const loginStatsByUser = new Map<
      string,
      {
        successfulLogins: number;
        failedLogins: number;
        lastLoginAt: Date | null;
        lastAttemptAt: Date | null;
      }
    >();

    for (const log of rangeLoginLogs) {
      const userId = log.user?.id;
      if (!userId) continue;

      const current = loginStatsByUser.get(userId) ?? {
        successfulLogins: 0,
        failedLogins: 0,
        lastLoginAt: null,
        lastAttemptAt: null,
      };

      if (log.success) {
        current.successfulLogins += 1;
        if (!current.lastLoginAt || log.createdAt > current.lastLoginAt) {
          current.lastLoginAt = log.createdAt;
        }
      } else {
        current.failedLogins += 1;
      }

      if (!current.lastAttemptAt || log.createdAt > current.lastAttemptAt) {
        current.lastAttemptAt = log.createdAt;
      }

      loginStatsByUser.set(userId, current);
    }

    const roleCounts = {
      admin: users.filter((user) => user.rol === Role.Admin).length,
      recepcionista: users.filter((user) => user.rol === Role.Recepcionista).length,
    };

    const filteredUsers = users.filter((user) =>
      roleFilter === 'all' ? true : user.rol === roleFilter,
    );

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        range: rangeConfig.range,
        rangeLabel: rangeConfig.label,
        startDate: rangeConfig.startDate,
        endDate: rangeConfig.endDate,
        role: roleFilter,
      },
      welcome: {
        title: 'Inicio del laboratorio',
        subtitle:
          'Monitorea ingresos, demanda, actividad de usuarios y salud operativa del laboratorio desde un solo lugar.',
      },
      kpis: {
        revenueInRange,
        createdServicesInRange: createdServicesInRange.length,
        completedServicesInRange: completedServicesInRange.length,
        averageTicket,
        pendingServices: pendingCount,
        inProgressServices: inProgressCount,
        cancelledServicesInRange: cancelledInRangeCount,
        totalUsers: users.length,
        adminUsers: roleCounts.admin,
        receptionistUsers: roleCounts.recepcionista,
      },
      studies: {
        topInRange: studyRanking.top,
        bottomInRange: studyRanking.bottom,
        rankingInRange: studyRanking.ranked.slice(0, 10),
      },
      branches: {
        strongestInRange: branchSummary[0] ?? null,
        breakdownInRange: branchSummary,
      },
      logins: {
        successfulInRange: successfulLogins.length,
        failedInRange: failedLogins.length,
        uniqueUsersInRange: uniqueUsers,
        recent: recentLoginLogs.map((log) => ({
          id: log.id,
          success: log.success,
          createdAt: log.createdAt,
          userName: log.user?.nombre ?? null,
          email: log.user?.email ?? log.emailIntent ?? null,
          ip: log.ip ?? null,
          userAgent: log.userAgent ?? null,
        })),
        users: filteredUsers.map((user) => {
          const stats = loginStatsByUser.get(user.id);
          return {
            id: user.id,
            nombre: user.nombre,
            email: user.email,
            rol: user.rol,
            confirmed: user.confirmed,
            createdAt: user.createdAt,
            successfulLogins: stats?.successfulLogins ?? 0,
            failedLogins: stats?.failedLogins ?? 0,
            lastLoginAt: stats?.lastLoginAt ?? null,
            lastAttemptAt: stats?.lastAttemptAt ?? null,
          };
        }),
      },
      finance: {
        savedTodayCut: savedTodayCut
          ? {
              id: savedTodayCut.id,
              closingDate: savedTodayCut.closingDate,
              totalAmount: this.toNumber(savedTodayCut.totalAmount),
              servicesCount: savedTodayCut.servicesCount,
              updatedAt: savedTodayCut.updatedAt,
            }
          : null,
      },
      trends: {
        revenueSeries: trend,
      },
      operations: {
        latestCompletedServices: completedServicesInRange.slice(0, 8).map((service) => ({
          id: service.id,
          folio: service.folio,
          patientName: service.patient
            ? `${service.patient.firstName} ${service.patient.lastName} ${service.patient.middleName ?? ''}`.trim()
            : 'Sin paciente',
          studySummary: this.summarizeStudies(service),
          totalAmount: this.toNumber(service.totalAmount),
          completedAt: service.completedAt ?? service.updatedAt ?? service.createdAt,
        })),
      },
    };
  }
}
