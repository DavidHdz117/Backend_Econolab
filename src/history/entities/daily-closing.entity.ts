import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  getPortableCreateDateColumnOptions,
  getPortableJsonColumnOptions,
  getPortableTimestampColumnOptions,
  getPortableUpdateDateColumnOptions,
} from '../../database/portable-column-options';

export type DailyClosingServiceSnapshot = {
  serviceId: number;
  folio: string;
  patientName: string;
  patientPhone?: string | null;
  doctorName?: string | null;
  studySummary: string;
  studiesCount?: number;
  branchName: string;
  sampleAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  deliveryAt?: string | null;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
};

export type DailyClosingBranchSnapshot = {
  branchName: string;
  servicesCount: number;
  revenueTotal: number;
};

export type DailyClosingStudySnapshot = {
  studyName: string;
  times: number;
};

export type DailyClosingHourSnapshot = {
  hour: string;
  servicesCount: number;
  revenueTotal: number;
};

@Entity({ name: 'daily_closings' })
@Index('idx_daily_closings_closing_date', ['closingDate'], { unique: true })
export class DailyClosing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  closingDate: string;

  @Column(getPortableTimestampColumnOptions())
  periodStart: Date;

  @Column(getPortableTimestampColumnOptions())
  periodEnd: Date;

  @Column({ type: 'int', default: 0 })
  servicesCount: number;

  @Column({ type: 'int', default: 0 })
  patientsCount: number;

  @Column({ type: 'int', default: 0 })
  studiesCount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotalAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  averageTicket: number;

  @Column(getPortableJsonColumnOptions())
  branchBreakdown: DailyClosingBranchSnapshot[];

  @Column(getPortableJsonColumnOptions())
  topStudies: DailyClosingStudySnapshot[];

  @Column(getPortableJsonColumnOptions())
  hourlyBreakdown: DailyClosingHourSnapshot[];

  @Column(getPortableJsonColumnOptions())
  servicesSnapshot: DailyClosingServiceSnapshot[];

  @CreateDateColumn(getPortableCreateDateColumnOptions())
  createdAt: Date;

  @UpdateDateColumn(getPortableUpdateDateColumnOptions())
  updatedAt: Date;
}
