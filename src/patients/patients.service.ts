import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientStatusDto } from './dto/update-patient-status.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Patient } from './entities/patient.entity';

export type PatientStatusFilter = 'active' | 'inactive' | 'all';

const SQL_NORMALIZE_FROM =
  '\u00E1\u00E9\u00ED\u00F3\u00FA\u00E4\u00EB\u00EF\u00F6\u00FC\u00E0\u00E8\u00EC\u00F2\u00F9\u00C1\u00C9\u00CD\u00D3\u00DA\u00C4\u00CB\u00CF\u00D6\u00DC\u00C0\u00C8\u00CC\u00D2\u00D9\u00F1\u00D1';
const SQL_NORMALIZE_TO = 'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly repo: Repository<Patient>,
  ) {}

  private normalizeStatusFilter(status?: string): PatientStatusFilter {
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

  private buildNormalizedSql(field: string) {
    return `regexp_replace(lower(translate(coalesce(${field}, ''), '${SQL_NORMALIZE_FROM}', '${SQL_NORMALIZE_TO}')), '[^a-z0-9]+', '', 'g')`;
  }

  private buildFullNameSql(alias: string) {
    return `concat_ws(' ', ${alias}.firstName, ${alias}.lastName, ${alias}.middleName)`;
  }

  private async findByIdOrFail(id: number) {
    const patient = await this.repo.findOne({ where: { id } });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado.');
    }

    return patient;
  }

  private async findPatientDuplicateByDocument(
    documentType?: string,
    documentNumber?: string,
    excludeId?: number,
    activeOnly = false,
  ) {
    const normalizedType = this.normalizeSearchValue(documentType ?? '');
    const normalizedNumber = this.normalizeSearchValue(documentNumber ?? '');

    if (!normalizedType || !normalizedNumber) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('patient')
      .where(`${this.buildNormalizedSql('patient.documentType')} = :documentType`, {
        documentType: normalizedType,
      })
      .andWhere(
        `${this.buildNormalizedSql('patient.documentNumber')} = :documentNumber`,
        { documentNumber: normalizedNumber },
      );

    if (excludeId) {
      qb.andWhere('patient.id != :excludeId', { excludeId });
    }

    if (activeOnly) {
      qb.andWhere('patient.isActive = true');
    }

    return qb.getOne();
  }

  private async findPatientDuplicateByIdentity(
    patient: Pick<Patient, 'firstName' | 'lastName' | 'middleName' | 'birthDate'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`,
    );

    if (!normalizedFullName || !patient.birthDate) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('patient')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('patient'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere('patient.birthDate = :birthDate', {
        birthDate: patient.birthDate,
      });

    if (excludeId) {
      qb.andWhere('patient.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async assertNoDuplicatePatient(
    patient: Pick<
      Patient,
      | 'firstName'
      | 'lastName'
      | 'middleName'
      | 'birthDate'
      | 'documentType'
      | 'documentNumber'
    >,
    excludeId?: number,
  ) {
    const documentDuplicate = await this.findPatientDuplicateByDocument(
      patient.documentType,
      patient.documentNumber,
      excludeId,
    );

    if (documentDuplicate) {
      throw new ConflictException(
        'Ya existe un paciente con ese tipo y numero de documento.',
      );
    }

    const identityDuplicate = await this.findPatientDuplicateByIdentity(
      patient,
      excludeId,
    );

    if (identityDuplicate) {
      throw new ConflictException(
        'Ya existe un paciente con el mismo nombre y fecha de nacimiento.',
      );
    }
  }

  async search(search: string, page = 1, limit = 10, status?: string) {
    const normalizedStatus = this.normalizeStatusFilter(status);
    const qb = this.repo
      .createQueryBuilder('patient')
      .select([
        'patient.id',
        'patient.firstName',
        'patient.lastName',
        'patient.middleName',
        'patient.gender',
        'patient.birthDate',
        'patient.phone',
        'patient.email',
        'patient.addressLine',
        'patient.addressBetween',
        'patient.addressCity',
        'patient.addressState',
        'patient.addressZip',
        'patient.documentType',
        'patient.documentNumber',
        'patient.isActive',
        'patient.createdAt',
      ])
      .orderBy('patient.lastName', 'ASC')
      .addOrderBy('patient.firstName', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (normalizedStatus !== 'all') {
      qb.andWhere('patient.isActive = :isActive', {
        isActive: normalizedStatus === 'active',
      });
    }

    const normalizedSearch = this.normalizeSearchValue(search);
    if (normalizedSearch) {
      const normalizedFields = [
        this.buildNormalizedSql('patient.firstName'),
        this.buildNormalizedSql('patient.lastName'),
        this.buildNormalizedSql('patient.middleName'),
        this.buildNormalizedSql(this.buildFullNameSql('patient')),
        this.buildNormalizedSql('patient.phone'),
        this.buildNormalizedSql('patient.email'),
        this.buildNormalizedSql('patient.documentNumber'),
        this.buildNormalizedSql('patient.addressLine'),
      ];

      qb.andWhere(
        `(${normalizedFields
          .map((field) => `${field} LIKE :search`)
          .join(' OR ')})`,
        {
          search: `%${normalizedSearch}%`,
        },
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

  async create(dto: CreatePatientDto) {
    await this.assertNoDuplicatePatient({
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName,
      birthDate: dto.birthDate,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
    });

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    return this.findByIdOrFail(id);
  }

  async update(id: number, dto: UpdatePatientDto) {
    const patient = await this.findByIdOrFail(id);

    await this.assertNoDuplicatePatient(
      {
        firstName: dto.firstName ?? patient.firstName,
        lastName: dto.lastName ?? patient.lastName,
        middleName: dto.middleName ?? patient.middleName,
        birthDate: dto.birthDate ?? patient.birthDate,
        documentType: dto.documentType ?? patient.documentType,
        documentNumber: dto.documentNumber ?? patient.documentNumber,
      },
      id,
    );

    const merged = this.repo.merge(patient, dto);
    return this.repo.save(merged);
  }

  async softDelete(id: number) {
    await this.findByIdOrFail(id);
    await this.repo.update({ id }, { isActive: false });
    return { message: 'Paciente desactivado correctamente.' };
  }

  async updateStatus(id: number, dto: UpdatePatientStatusDto) {
    const patient = await this.findByIdOrFail(id);

    if (patient.isActive === dto.isActive) {
      return patient;
    }

    patient.isActive = dto.isActive;
    return this.repo.save(patient);
  }

  async existsByDocument(documentType: string, documentNumber: string) {
    const patient = await this.findPatientDuplicateByDocument(
      documentType,
      documentNumber,
      undefined,
      true,
    );

    return { exists: !!patient, patientId: patient?.id ?? null };
  }
}
