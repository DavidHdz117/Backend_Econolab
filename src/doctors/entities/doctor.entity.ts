import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  Unique,
} from 'typeorm';
import { SyncMetadataEntity } from '../../common/entities/sync-metadata.entity';
import {
  getPortableCreateDateColumnOptions,
  getPortableUpdateDateColumnOptions,
} from '../../database/portable-column-options';

@Entity({ name: 'doctors' })
@Unique(['licenseNumber'])
export class Doctor extends SyncMetadataEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_doctors_name')
  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ length: 100, nullable: true })
  middleName?: string;

  @Index('idx_doctors_email')
  @Column({ length: 150, nullable: true })
  email?: string;

  @Index('idx_doctors_phone')
  @Column({ length: 20, nullable: true })
  phone?: string;

  @Column({ length: 150, nullable: true })
  specialty?: string; // especialidad del médico, opcional

  @Column({ length: 50, nullable: true })
  licenseNumber?: string; // cédula profesional

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn(getPortableCreateDateColumnOptions())
  createdAt: Date;

  @UpdateDateColumn(getPortableUpdateDateColumnOptions())
  updatedAt: Date;
}
