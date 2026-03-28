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

type DoctorStatusFilter = 'active' | 'inactive' | 'all';

const SQL_NORMALIZE_FROM =
  '\u00E1\u00E9\u00ED\u00F3\u00FA\u00E4\u00EB\u00EF\u00F6\u00FC\u00E0\u00E8\u00EC\u00F2\u00F9\u00C1\u00C9\u00CD\u00D3\u00DA\u00C4\u00CB\u00CF\u00D6\u00DC\u00C0\u00C8\u00CC\u00D2\u00D9\u00F1\u00D1';
const SQL_NORMALIZE_TO = 'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor)
    private readonly repo: Repository<Doctor>,
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

  private buildNormalizedSql(field: string) {
    return `regexp_replace(translate(lower(coalesce(${field}, '')), '${SQL_NORMALIZE_FROM}', '${SQL_NORMALIZE_TO}'), '[^a-z0-9]+', '', 'g')`;
  }

  private buildDigitsOnlySql(field: string) {
    return `regexp_replace(coalesce(${field}, ''), '[^0-9]+', '', 'g')`;
  }

  private buildLowerTrimSql(field: string) {
    return `lower(trim(coalesce(${field}, '')))`;
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
    await this.findByIdOrFail(id);
    await this.repo.update({ id }, { isActive: false });
    return { message: 'Medico desactivado correctamente.' };
  }

  async updateStatus(id: number, dto: UpdateDoctorStatusDto) {
    const doctor = await this.findByIdOrFail(id);

    if (doctor.isActive === dto.isActive) {
      return doctor;
    }

    doctor.isActive = dto.isActive;
    return this.repo.save(doctor);
  }

  async hardDelete(id: number) {
    const result = await this.repo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Medico no encontrado.');
    }

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
