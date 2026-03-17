import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorStatusDto } from './dto/update-doctor-status.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { Doctor } from './entities/doctor.entity';

export type DoctorStatusFilter = 'active' | 'inactive' | 'all';

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

  private buildNormalizedSql(field: string) {
    return `regexp_replace(translate(lower(coalesce(${field}, '')), 'áéíóúäëïöüàèìòùñ', 'aeiouaeiouaeioun'), '[^a-z0-9]+', '', 'g')`;
  }

  private async findByIdOrFail(id: number) {
    const doctor = await this.repo.findOne({ where: { id } });

    if (!doctor) {
      throw new NotFoundException('Medico no encontrado.');
    }

    return doctor;
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
        this.buildNormalizedSql(
          `concat_ws(' ', doctor.firstName, doctor.lastName, doctor.middleName)`,
        ),
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
    if (dto.licenseNumber) {
      const exists = await this.repo.findOne({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (exists) {
        throw new ConflictException(
          'Ya existe un medico registrado con esta cedula profesional.',
        );
      }
    }

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    return this.findByIdOrFail(id);
  }

  async update(id: number, dto: UpdateDoctorDto) {
    const doctor = await this.findByIdOrFail(id);

    if (dto.licenseNumber) {
      const duplicated = await this.repo.findOne({
        where: {
          licenseNumber: dto.licenseNumber,
          id: Not(id),
        },
      });

      if (duplicated) {
        throw new ConflictException(
          'Ya existe otro medico con esta cedula profesional.',
        );
      }
    }

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
    const doctor = await this.repo.findOne({
      where: { licenseNumber, isActive: true },
      select: ['id'],
    });
    return { exists: !!doctor, doctorId: doctor?.id ?? null };
  }
}
