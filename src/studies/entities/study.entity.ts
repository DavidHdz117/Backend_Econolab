import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import { SyncMetadataEntity } from '../../common/entities/sync-metadata.entity';
import {
  getPortableCreateDateColumnOptions,
  getPortableEnumColumnOptions,
  getPortableIntegerArrayColumnOptions,
  getPortableUpdateDateColumnOptions,
} from '../../database/portable-column-options';

export enum StudyType {
  STUDY = 'study', // Estudio individual
  PACKAGE = 'package', // Paquete de estudios
  OTHER = 'other',
}

export enum StudyStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

@Entity({ name: 'studies' })
export class Study extends SyncMetadataEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_studies_name')
  @Column({ length: 200 })
  name: string; // Nombre del análisis/paquete

  @Index('idx_studies_code')
  @Column({ length: 50, unique: true })
  code: string; // Clave o referencia

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'int', default: 60 })
  durationMinutes: number; // duración en minutos (ej. 60 -> 01:00 h)

  @Column(getPortableEnumColumnOptions(StudyType, StudyType.STUDY))
  type: StudyType;

  // Precios
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  normalPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  difPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  specialPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  hospitalPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  otherPrice: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  defaultDiscountPercent: number; // % Descuento sugerido

  @Column({ length: 150, nullable: true })
  method?: string;

  @Column({ length: 150, nullable: true })
  indicator?: string;

  @Column(getPortableIntegerArrayColumnOptions({ nullable: false }))
  packageStudyIds: number[];

  @Column(getPortableEnumColumnOptions(StudyStatus, StudyStatus.ACTIVE))
  status: StudyStatus; // ACTIVO / SUSPENDIDO

  @Column({ default: true })
  isActive: boolean; // para baja lógica

  @CreateDateColumn(getPortableCreateDateColumnOptions({}, 'timestamp'))
  createdAt: Date;

  @UpdateDateColumn(getPortableUpdateDateColumnOptions({}, 'timestamp'))
  updatedAt: Date;
}
