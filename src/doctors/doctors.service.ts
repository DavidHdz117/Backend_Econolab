import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorStatusDto } from './dto/update-doctor-status.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { Doctor } from './entities/doctor.entity';
import { DatabaseDialectService } from '../database/database-dialect.service';
import { RuntimePolicyService } from '../runtime/runtime-policy.service';

type DoctorStatusFilter = 'active' | 'inactive' | 'all';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor)
    private readonly repo: Repository<Doctor>,
    private readonly databaseDialect: DatabaseDialectService,
    private readonly runtimePolicy: RuntimePolicyService,
  ) {}

  private normalizeStatusFilter(status?: string): DoctorStatusFilter {
    if (status === 'inactive' || status === 'all') {
      return status;
    }

    return 'active';
  }

  private normalizeSearchValue(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private normalizePhoneValue(value?: string | null) {
    return (value ?? '').replace(/\D+/g, '');
  }

  private normalizeEmailValue(value?: string | null) {
    return (value ?? '').trim().toLowerCase();
  }

  private get isSqlite() {
    return this.databaseDialect.type === 'sqlite';
  }

  private buildNormalizedSql(field: string) {
    return this.databaseDialect.buildCompactSearchExpression(field);
  }

  private buildDigitsOnlySql(field: string) {
    return this.databaseDialect.buildDigitsOnlyExpression(field);
  }

  private buildLowerTrimSql(field: string) {
    return this.databaseDialect.buildLowerTrimExpression(field);
  }

  private buildFullNameSql(alias: string) {
    return `concat_ws(' ', ${alias}.firstName, ${alias}.lastName, ${alias}.middleName)`;
  }

  private async findByIdOrFail(id: number) {
    const doctor = await this.repo.findOne({ where: { id } });

    if (!doctor) {
      throw new NotFoundException('Medico no encontrado.');
    }

    return doctor;
  }

  private async findDoctorDuplicateByLicense(
    licenseNumber?: string,
    excludeId?: number,
    activeOnly = false,
  ) {
    const normalizedLicense = this.normalizeSearchValue(licenseNumber ?? '');
    if (!normalizedLicense) {
      return null;
    }

    if (this.isSqlite) {
      const candidates = await this.repo.find({
        where: activeOnly ? { isActive: true } : {},
      });

      return (
        candidates.find((candidate) => {
          if (excludeId && candidate.id === excludeId) {
            return false;
          }

          return (
            this.normalizeSearchValue(candidate.licenseNumber ?? '') ===
            normalizedLicense
          );
        }) ?? null
      );
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(`${this.buildNormalizedSql('doctor.licenseNumber')} = :license`, {
        license: normalizedLicense,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    if (activeOnly) {
      qb.andWhere('doctor.isActive = true');
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameAndEmail(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName' | 'email'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );
    const normalizedEmail = this.normalizeEmailValue(doctor.email);

    if (!normalizedFullName || !normalizedEmail) {
      return null;
    }

    if (this.isSqlite) {
      const candidates = await this.repo.find();

      return (
        candidates.find((candidate) => {
          if (excludeId && candidate.id === excludeId) {
            return false;
          }

          const candidateNormalizedFullName = this.normalizeSearchValue(
            `${candidate.firstName} ${candidate.lastName} ${candidate.middleName ?? ''}`,
          );

          return (
            candidateNormalizedFullName === normalizedFullName &&
            this.normalizeEmailValue(candidate.email) === normalizedEmail
          );
        }) ?? null
      );
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere(`${this.buildLowerTrimSql('doctor.email')} = :email`, {
        email: normalizedEmail,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameAndPhone(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName' | 'phone'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );
    const normalizedPhone = this.normalizePhoneValue(doctor.phone);

    if (!normalizedFullName || !normalizedPhone) {
      return null;
    }

    if (this.isSqlite) {
      const candidates = await this.repo.find();

      return (
        candidates.find((candidate) => {
          if (excludeId && candidate.id === excludeId) {
            return false;
          }

          const candidateNormalizedFullName = this.normalizeSearchValue(
            `${candidate.firstName} ${candidate.lastName} ${candidate.middleName ?? ''}`,
          );

          return (
            candidateNormalizedFullName === normalizedFullName &&
            this.normalizePhoneValue(candidate.phone) === normalizedPhone
          );
        }) ?? null
      );
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere(`${this.buildDigitsOnlySql('doctor.phone')} = :phone`, {
        phone: normalizedPhone,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameAndSpecialty(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName' | 'specialty'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );
    const normalizedSpecialty = this.normalizeSearchValue(
      doctor.specialty ?? '',
    );

    if (!normalizedFullName || !normalizedSpecialty) {
      return null;
    }

    if (this.isSqlite) {
      const candidates = await this.repo.find();

      return (
        candidates.find((candidate) => {
          if (excludeId && candidate.id === excludeId) {
            return false;
          }

          const candidateNormalizedFullName = this.normalizeSearchValue(
            `${candidate.firstName} ${candidate.lastName} ${candidate.middleName ?? ''}`,
          );

          return (
            candidateNormalizedFullName === normalizedFullName &&
            this.normalizeSearchValue(candidate.specialty ?? '') ===
              normalizedSpecialty
          );
        }) ?? null
      );
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere(`${this.buildNormalizedSql('doctor.specialty')} = :specialty`, {
        specialty: normalizedSpecialty,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameOnly(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );

    if (!normalizedFullName) {
      return null;
    }

    if (this.isSqlite) {
      const candidates = await this.repo.find();

      return (
        candidates.find((candidate) => {
          if (excludeId && candidate.id === excludeId) {
            return false;
          }

          const candidateNormalizedFullName = this.normalizeSearchValue(
            `${candidate.firstName} ${candidate.lastName} ${candidate.middleName ?? ''}`,
          );

          return candidateNormalizedFullName === normalizedFullName;
        }) ?? null
      );
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      );

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async assertNoDuplicateDoctor(
    doctor: Pick<
      Doctor,
      | 'firstName'
      | 'lastName'
      | 'middleName'
      | 'email'
      | 'phone'
      | 'specialty'
      | 'licenseNumber'
    >,
    excludeId?: number,
  ) {
    const licenseDuplicate = await this.findDoctorDuplicateByLicense(
      doctor.licenseNumber,
      excludeId,
    );

    if (licenseDuplicate) {
      throw new ConflictException(
        'Ya existe un medico con esa cedula profesional.',
      );
    }

    const emailDuplicate = await this.findDoctorDuplicateByNameAndEmail(
      doctor,
      excludeId,
    );

    if (emailDuplicate) {
      throw new ConflictException(
        'Ya existe un medico con el mismo nombre y correo electronico.',
      );
    }

    const phoneDuplicate = await this.findDoctorDuplicateByNameAndPhone(
      doctor,
      excludeId,
    );

    if (phoneDuplicate) {
      throw new ConflictException(
        'Ya existe un medico con el mismo nombre y telefono.',
      );
    }

    if (
      !this.normalizeSearchValue(doctor.licenseNumber ?? '') &&
      !this.normalizeEmailValue(doctor.email) &&
      !this.normalizePhoneValue(doctor.phone)
    ) {
      const specialtyDuplicate =
        await this.findDoctorDuplicateByNameAndSpecialty(doctor, excludeId);

      if (specialtyDuplicate) {
        throw new ConflictException(
          'Ya existe un medico con el mismo nombre y especialidad.',
        );
      }

      if (!this.normalizeSearchValue(doctor.specialty ?? '')) {
        const nameDuplicate = await this.findDoctorDuplicateByNameOnly(
          doctor,
          excludeId,
        );

        if (nameDuplicate) {
          throw new ConflictException(
            'Ya existe un medico con el mismo nombre completo.',
          );
        }
      }
    }
  }

  async search(search: string, page = 1, limit = 10, status?: string) {
    const normalizedStatus = this.normalizeStatusFilter(status);

    if (this.isSqlite) {
      const rows = await this.repo.find({
        where:
          normalizedStatus === 'all'
            ? {}
            : { isActive: normalizedStatus === 'active' },
        order: {
          lastName: 'ASC',
          firstName: 'ASC',
        },
      });

      const normalizedSearch = this.normalizeSearchValue(search);
      const filtered = !normalizedSearch
        ? rows
        : rows.filter((doctor) => {
            const haystack = [
              doctor.firstName,
              doctor.lastName,
              doctor.middleName,
              `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
              doctor.email,
              doctor.phone,
              doctor.licenseNumber,
              doctor.specialty,
            ]
              .map((value) => this.normalizeSearchValue(value ?? ''))
              .filter(Boolean);

            return haystack.some((value) => value.includes(normalizedSearch));
          });

      const start = Math.max(0, (page - 1) * limit);
      const data = filtered.slice(start, start + limit);

      return {
        data,
        meta: {
          page,
          limit,
          total: filtered.length,
        },
      };
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .select([
        'doctor.id',
        'doctor.firstName',
        'doctor.lastName',
        'doctor.middleName',
        'doctor.email',
        'doctor.phone',
        'doctor.specialty',
        'doctor.licenseNumber',
        'doctor.notes',
        'doctor.isActive',
        'doctor.createdAt',
      ])
      .orderBy('doctor.lastName', 'ASC')
      .addOrderBy('doctor.firstName', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (normalizedStatus !== 'all') {
      qb.andWhere('doctor.isActive = :isActive', {
        isActive: normalizedStatus === 'active',
      });
    }

    const normalizedSearch = this.normalizeSearchValue(search);
    if (normalizedSearch) {
      const normalizedFields = [
        this.buildNormalizedSql('doctor.firstName'),
        this.buildNormalizedSql('doctor.lastName'),
        this.buildNormalizedSql('doctor.middleName'),
        this.buildNormalizedSql(this.buildFullNameSql('doctor')),
        this.buildNormalizedSql('doctor.email'),
        this.buildNormalizedSql('doctor.phone'),
        this.buildNormalizedSql('doctor.licenseNumber'),
        this.buildNormalizedSql('doctor.specialty'),
      ];

      qb.andWhere(
        `(${normalizedFields
          .map((field) => `${field} LIKE :search`)
          .join(' OR ')})`,
        { search: `%${normalizedSearch}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  async create(dto: CreateDoctorDto) {
    await this.assertNoDuplicateDoctor({
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName,
      email: dto.email,
      phone: dto.phone,
      specialty: dto.specialty,
      licenseNumber: dto.licenseNumber,
    });

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    return this.findByIdOrFail(id);
  }

  async update(id: number, dto: UpdateDoctorDto) {
    const doctor = await this.findByIdOrFail(id);

    await this.assertNoDuplicateDoctor(
      {
        firstName: dto.firstName ?? doctor.firstName,
        lastName: dto.lastName ?? doctor.lastName,
        middleName: dto.middleName ?? doctor.middleName,
        email: dto.email ?? doctor.email,
        phone: dto.phone ?? doctor.phone,
        specialty: dto.specialty ?? doctor.specialty,
        licenseNumber: dto.licenseNumber ?? doctor.licenseNumber,
      },
      id,
    );

    const merged = this.repo.merge(doctor, dto);
    return this.repo.save(merged);
  }

  async softDelete(id: number) {
    const doctor = await this.findByIdOrFail(id);
    doctor.isActive = false;
    doctor.deletedAt = new Date();
    await this.repo.save(doctor);
    return { message: 'Medico desactivado correctamente.' };
  }

  async updateStatus(id: number, dto: UpdateDoctorStatusDto) {
    const doctor = await this.findByIdOrFail(id);

    if (doctor.isActive === dto.isActive) {
      return doctor;
    }

    doctor.isActive = dto.isActive;
    doctor.deletedAt = dto.isActive ? null : new Date();
    return this.repo.save(doctor);
  }

  async hardDelete(id: number) {
    this.runtimePolicy.assertHardDeleteAllowed('medicos');
    const doctor = await this.findByIdOrFail(id);
    await this.repo.remove(doctor);

    return { message: 'Medico eliminado definitivamente de la base de datos.' };
  }

  async existsByLicense(licenseNumber: string) {
    const doctor = await this.findDoctorDuplicateByLicense(
      licenseNumber,
      undefined,
      true,
    );

    return { exists: !!doctor, doctorId: doctor?.id ?? null };
  }
}
