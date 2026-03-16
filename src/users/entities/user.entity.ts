import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Role } from 'src/common/enums/roles.enum';
import { UserSession } from 'src/auth/entities/user-session.entity';

@Entity()
export class User {
  @OneToMany(() => UserSession, (session) => session.user)
  sessions: UserSession[];

  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'varchar', length: 50 })
  nombre: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  email: string;

  @Column({ length: 60 })
  password: string;

  @Column({ type: 'varchar', length: 6, nullable: true })
  token: string | null;

  @Column({ type: 'boolean', default: false })
  confirmed: boolean;

  @Column({ type: 'enum', enum: Role, default: Role.Unassigned })
  rol: Role;

  @Column({ type: 'text', nullable: true })
  profileImageData: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  profileImageMimeType: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  googleAvatarUrl: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resetTokenExpiresAt: Date | null;

  @Column({ type: 'int', default: 0 })
  resetRequestCount: number;

  @Column({ type: 'timestamp', nullable: true })
  resetRequestWindowStart: Date | null;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lockUntil: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
