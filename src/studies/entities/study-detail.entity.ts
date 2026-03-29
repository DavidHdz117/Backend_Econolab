import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Study } from './study.entity';
import { SyncMetadataEntity } from '../../common/entities/sync-metadata.entity';
import {
  getPortableCreateDateColumnOptions,
  getPortableEnumColumnOptions,
  getPortableUpdateDateColumnOptions,
} from '../../database/portable-column-options';

export enum StudyDetailType {
  CATEGORY = 'category', // categoría (ej. FORMULA ROJA)
  PARAMETER = 'parameter', // parámetro concreto (ej. HEMOGLOBINA)
}

@Entity({ name: 'study_details' })
export class StudyDetail extends SyncMetadataEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Study, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'study_id' })
  study: Study;

  @Column({ name: 'study_id' })
  studyId: number;

  // Jerarquía: una categoría puede pertenecer a otra
  @ManyToOne(() => StudyDetail, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent?: StudyDetail | null;

  @Column({ name: 'parent_id', nullable: true })
  parentId?: number | null;

  @Column(getPortableEnumColumnOptions(StudyDetailType))
  dataType: StudyDetailType; // CATEGORY o PARAMETER

  @Column({ length: 150 })
  name: string; // nombre de categoría o del parámetro

  @Column({ type: 'int', default: 1 })
  sortOrder: number; // Orden

  @Column({ length: 50, nullable: true })
  unit?: string; // Unidades

  @Column({ length: 255, nullable: true })
  referenceValue?: string; // Valores de referencia

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn(getPortableCreateDateColumnOptions({}, 'timestamp'))
  createdAt: Date;

  @UpdateDateColumn(getPortableUpdateDateColumnOptions({}, 'timestamp'))
  updatedAt: Date;
}
