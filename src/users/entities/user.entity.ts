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
import { SyncMetadataEntity } from '../../common/entities/sync-metadata.entity';
import {
  getPortableCreateDateColumnOptions,
  getPortableEnumColumnOptions,
  getPortableTimestampColumnOptions,
  getPortableUpdateDateColumnOptions,
} from '../../database/portable-column-options';

@Entity()
export class User extends SyncMetadataEntity {
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

  @Column(getPortableEnumColumnOptions(Role, Role.Unassigned))
  rol: Role;

  @Column({ type: 'text', nullable: true })
  profileImageData: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  profileImageMimeType: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  googleAvatarUrl: string | null;

  @Column(getPortableTimestampColumnOptions({ nullable: true }, 'timestamp'))
  resetTokenExpiresAt: Date | null;

  @Column({ type: 'int', default: 0 })
  resetRequestCount: number;

  @Column(getPortableTimestampColumnOptions({ nullable: true }, 'timestamp'))
  resetRequestWindowStart: Date | null;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column(getPortableTimestampColumnOptions({ nullable: true }, 'timestamp'))
  lockUntil: Date | null;

  @CreateDateColumn(getPortableCreateDateColumnOptions({}, 'timestamp'))
  createdAt: Date;

  @UpdateDateColumn(getPortableUpdateDateColumnOptions({}, 'timestamp'))
  updatedAt: Date;
}
