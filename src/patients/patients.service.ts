import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Not } from 'typeorm';
import { Patient } from './entities/patient.entity';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly repo: Repository<Patient>,
  ) { }

  async search(search: string, page = 1, limit = 10) {
    const where = search
      ? [
        { firstName: Like(`%${search}%`), isActive: true },
        { lastName: Like(`%${search}%`), isActive: true },
        { phone: Like(`%${search}%`), isActive: true },
        { documentNumber: Like(`%${search}%`), isActive: true },
      ]
      : { isActive: true };

    const [data, total] = await this.repo.findAndCount({
      where,
      take: limit,
      skip: (page - 1) * limit,
      order: { lastName: 'ASC', firstName: 'ASC' },
      select: [
        'id',
        'firstName',
        'lastName',
        'middleName',
        'gender',
        'birthDate',
        'phone',
        'email',
        'createdAt',
        'addressBetween',
        'addressCity',
        'addressState',
        'addressZip',
        'documentType',
        'documentNumber',
      ],
    });

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
          'Ya existe un paciente registrado con este tipo y número de documento.',
        );
      }
    }

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    const patient = await this.repo.findOne({ where: { id, isActive: true } });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado.');
    }
    return patient;
  }

  async update(id: number, dto: UpdatePatientDto) {
    const patient = await this.findOne(id); // lanza 404 si no existe

    // Si viene documento en el DTO, validamos que no exista en otro paciente
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
          'Ya existe otro paciente con este tipo y número de documento.',
        );
      }
    }

    const merged = this.repo.merge(patient, dto);
    return this.repo.save(merged);
  }

  async softDelete(id: number) {
    await this.findOne(id);
    await this.repo.update({ id }, { isActive: false });
    return { message: 'Paciente desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const result = await this.repo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Paciente no encontrado.');
    }

    return { message: 'Paciente eliminado definitivamente de la base de datos.' };
  }

  async existsByDocument(documentType: string, documentNumber: string) {
    const patient = await this.repo.findOne({
      where: { documentType, documentNumber, isActive: true },
      select: ['id'],
    });
    return { exists: !!patient, patientId: patient?.id ?? null };
  }
}
