import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import {
  getPortableCreateDateColumnOptions,
  getPortableTimestampColumnOptions,
} from '../../database/portable-column-options';

@Entity()
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id: string; // jti

  @ManyToOne(() => User, (user) => user.sessions, { onDelete: 'CASCADE' })
  user: User;

  @Column(getPortableTimestampColumnOptions({}, 'timestamp'))
  expiresAt: Date;

  @Column({ type: 'boolean', default: false })
  revoked: boolean;

  @Column({ type: 'varchar', length: 45, nullable: true }) // IPv4/IPv6
  ip: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn(getPortableCreateDateColumnOptions({}, 'timestamp'))
  createdAt: Date;
}
