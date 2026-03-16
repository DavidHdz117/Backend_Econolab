import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientStatusDto } from './dto/update-patient-status.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Patient } from './entities/patient.entity';

export type PatientStatusFilter = 'active' | 'inactive' | 'all';

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

  private buildStatusWhere(status: PatientStatusFilter) {
    if (status === 'all') {
      return {};
    }

    return { isActive: status === 'active' };
  }

  private normalizeSearchValue(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private buildNormalizedSql(field: string) {
    return `regexp_replace(lower(translate(coalesce(${field}, ''), 'áéíóúäëïöüàèìòùÁÉÍÓÚÄËÏÖÜÀÈÌÒÙñÑ', 'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN')), '[^a-z0-9]+', '', 'g')`;
  }

  private async findByIdOrFail(id: number) {
    const patient = await this.repo.findOne({ where: { id } });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado.');
    }

    return patient;
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
        this.buildNormalizedSql(
          `concat_ws(' ', patient.firstName, patient.lastName, patient.middleName)`,
        ),
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
    if (dto.documentType && dto.documentNumber) {
      const exists = await this.repo.findOne({
        where: {
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
        },
      });

      if (exists) {
        throw new ConflictException(
          'Ya existe un paciente registrado con este tipo y nÃºmero de documento.',
        );
      }
    }

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    return this.findByIdOrFail(id);
  }

  async update(id: number, dto: UpdatePatientDto) {
    const patient = await this.findByIdOrFail(id);

    if (dto.documentType && dto.documentNumber) {
      const duplicated = await this.repo.findOne({
        where: {
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
          id: Not(id),
        },
      });

      if (duplicated) {
        throw new ConflictException(
          'Ya existe otro paciente con este tipo y nÃºmero de documento.',
        );
      }
    }

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
    const patient = await this.repo.findOne({
      where: { documentType, documentNumber, isActive: true },
      select: ['id'],
    });

    return { exists: !!patient, patientId: patient?.id ?? null };
  }
}
