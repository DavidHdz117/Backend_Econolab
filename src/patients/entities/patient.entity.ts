import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  Unique,
} from 'typeorm';

export enum PatientGender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

@Entity({ name: 'patients' })
@Unique(['documentType', 'documentNumber'])
export class Patient {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_patients_name')
  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ length: 100, nullable: true })
  middleName?: string;

  @Column({ type: 'enum', enum: PatientGender, default: PatientGender.OTHER })
  gender: PatientGender;

  @Column({ type: 'date' })
  birthDate: string;

  @Index('idx_patients_phone')
  @Column({ length: 20, nullable: true })
  phone?: string;

  @Index('idx_patients_email')
  @Column({ length: 150, nullable: true })
  email?: string;

  @Column({ length: 255, nullable: true })
  addressLine?: string;

  @Column({ length: 255, nullable: true })
  addressBetween?: string;

  @Column({ length: 100, nullable: true })
  addressCity?: string;

  @Column({ length: 100, nullable: true })
  addressState?: string;

  @Column({ length: 20, nullable: true })
  addressZip?: string;

  @Column({ length: 20, nullable: true })
  documentType?: string;

  @Column({ length: 50, nullable: true })
  documentNumber?: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
