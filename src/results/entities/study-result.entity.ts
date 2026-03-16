import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../../services/entities/service-order.entity';
import { StudyDetail } from '../../studies/entities/study-detail.entity';

@Entity('study_results')
@Index('idx_study_results_service_order', ['serviceOrderId'])
@Index('idx_study_results_service_item', ['serviceOrderItemId'])
@Index('idx_study_results_active', ['isActive'])
export class StudyResult {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder: ServiceOrder;

  @Column({ name: 'service_order_id' })
  serviceOrderId: number;

  @ManyToOne(() => ServiceOrderItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_item_id' })
  serviceOrderItem: ServiceOrderItem;

  @Column({ name: 'service_order_item_id' })
  serviceOrderItemId: number;

  @Column({ type: 'timestamptz', nullable: true })
  sampleAt?: Date; // por si quieres copiar la fecha de muestra

  @Column({ type: 'timestamptz', nullable: true })
  reportedAt?: Date; // fecha en que se cerró el resultado

  @Column({ length: 150, nullable: true })
  method?: string; // MÉTODO

  @Column({ type: 'text', nullable: true })
  observations?: string; // OBSERVACIONES

  @Column({ default: true })
  isDraft: boolean; // true mientras esté en edición

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => StudyResultValue, (value) => value.result, {
    cascade: true,
    eager: true,
  })
  values: StudyResultValue[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('study_result_values')
export class StudyResultValue {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => StudyResult, (result) => result.values, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'study_result_id' })
  result: StudyResult;

  @Column({ name: 'study_result_id' })
  studyResultId: number;

  @ManyToOne(() => StudyDetail, { nullable: true })
  @JoinColumn({ name: 'study_detail_id' })
  studyDetail?: StudyDetail;

  @Column({ name: 'study_detail_id', nullable: true })
  studyDetailId?: number;

  // snapshots para que si cambias la configuración no se alteren resultados viejos
  @Column({ length: 150 })
  label: string; // nombre del parámetro (GLUCOSA, COLESTEROL, etc.)

  @Column({ length: 50, nullable: true })
  unit?: string; // mg/dL, g/dL, etc.

  @Column({ length: 255, nullable: true })
  referenceValue?: string; // valores de referencia

  @Column({ length: 100, nullable: true })
  value?: string; // resultado capturado (texto, número, NEGATIVO, etc.)

  @Column({ type: 'int', default: 1 })
  sortOrder: number; // orden en la tabla

  @Column({ default: true })
  visible: boolean; // checkbox VISIBLE en la pantalla

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
