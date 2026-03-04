import {Column, CreateDateColumn, UpdateDateColumn, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn,} from 'typeorm';
import { Study } from './study.entity';

export enum StudyDetailType {
    CATEGORY = 'category', // categoría (ej. FORMULA ROJA)
    PARAMETER = 'parameter', // parámetro concreto (ej. HEMOGLOBINA)
}

@Entity({ name: 'study_details', schema: 'operativo' })
export class StudyDetail {
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
    parent?: StudyDetail;

    @Column({ name: 'parent_id', nullable: true })
    parentId?: number;

    @Column({ type: 'enum', enum: StudyDetailType })
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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
