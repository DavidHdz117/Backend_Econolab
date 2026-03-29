import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import {
  getPortableCreateDateColumnOptions,
  getPortableGeneratedPrimaryColumnOptions,
} from '../../database/portable-column-options';

@Entity({ name: 'user_login_logs' })
export class UserLoginLog {
  @PrimaryGeneratedColumn(getPortableGeneratedPrimaryColumnOptions(true))
  id!: string | number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  // útil para loguear intentos fallidos con email no existente
  @Column({ type: 'varchar', length: 100, nullable: true })
  emailIntent?: string | null;

  @Column({ type: 'boolean', default: false })
  success!: boolean;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'user_agent' })
  userAgent?: string | null;

  @CreateDateColumn(getPortableCreateDateColumnOptions({ name: 'created_at' }))
  createdAt!: Date;
}
