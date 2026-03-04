import {Column, CreateDateColumn, UpdateDateColumn, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, OneToMany, Index,} from 'typeorm';
import { Patient } from '../../patients/entities/patient.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';

export enum ServiceStatus {
    PENDING = 'pending',        // PENDIENTE
    IN_PROGRESS = 'in_progress',// EN CURSO
    DELAYED = 'delayed',        // RETRASADO
    COMPLETED = 'completed',    // CONCLUIDO
    CANCELLED = 'cancelled',    // CANCELADO
}

@Entity({ name: 'service_orders', schema: 'operativo' })
@Index('idx_service_order_patient', ['patientId'])
@Index('idx_service_order_doctor', ['doctorId'])
@Index('idx_service_order_status', ['status'])
@Index('idx_service_order_created_at', ['createdAt'])
export class ServiceOrder {
    @PrimaryGeneratedColumn()
    id: number;

    @Index('idx_services_folio')
    @Column({ length: 50, unique: true })
    folio: string; // ECO2025xxxxx

    @ManyToOne(() => Patient, { eager: true })
    @JoinColumn({ name: 'patient_id' })
    patient: Patient;

    @Column({ name: 'patient_id' })
    patientId: number;

    @ManyToOne(() => Doctor, { eager: true, nullable: true })
    @JoinColumn({ name: 'doctor_id' })
    doctor?: Doctor;

    @Column({ name: 'doctor_id', nullable: true })
    doctorId?: number;

    // Por ahora dejamos sucursal como string, luego la puedes ligar a una tabla branches
    @Column({ length: 150, nullable: true })
    branchName?: string;

    // Fecha/hora de toma de muestra
    @Column({ type: 'timestamp', nullable: true })
    sampleAt?: Date;

    // Fecha/hora de entrega comprometida
    @Column({ type: 'timestamp', nullable: true })
    deliveryAt?: Date;

    @Column({
        type: 'enum',
        enum: ServiceStatus,
        default: ServiceStatus.PENDING,
    })
    status: ServiceStatus;

    // Totales
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    subtotalAmount: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
    courtesyPercent: number; // % de cortesía aplicado al subtotal

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    discountAmount: number; // monto de descuento por cortesía

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    totalAmount: number;

    @Column({ type: 'text', nullable: true })
    notes?: string;

    @Column({ default: true })
    isActive: boolean;

    @OneToMany(() => ServiceOrderItem, (item) => item.serviceOrder, {
        cascade: true,
        eager: true,
    })
    items: ServiceOrderItem[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

// Necesitamos la clase aquí por el circular import
@Entity({ name: 'service_order_items', schema: 'operativo' })
export class ServiceOrderItem {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ServiceOrder, (order) => order.items, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'service_order_id' })
    serviceOrder: ServiceOrder;

    @Column({ name: 'service_order_id' })
    serviceOrderId: number;

    @Column({ name: 'study_id' })
    studyId: number;

    @Column({ length: 200 })
    studyNameSnapshot: string; // Nombre del estudio al momento de crear el servicio

    @Column({ length: 20 })
    priceType: ServiceItemPriceType; // normal, especial, DIF, etc.

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    unitPrice: number;

    @Column({ type: 'int', default: 1 })
    quantity: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
    discountPercent: number; // descuento por ítem

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    subtotalAmount: number;
}

// Tipo de precio para el ítem
export enum ServiceItemPriceType {
    NORMAL = 'normal',
    DIF = 'dif',
    SPECIAL = 'special',
    HOSPITAL = 'hospital',
    OTHER = 'other',
}
