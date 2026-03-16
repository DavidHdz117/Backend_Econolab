import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Study, StudyStatus, StudyType } from './entities/study.entity';
import { StudyDetail } from './entities/study-detail.entity';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { CreateStudyDetailDto } from './dto/create-study-detail.dto';
import { UpdateStudyDetailDto } from './dto/update-study-detail.dto';
import { UpdateStudyDetailStatusDto } from './dto/update-study-detail-status.dto';

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
  ) {}

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

  private async validatePackageStudyIds(
    packageStudyIds: number[] | undefined,
    currentStudyId?: number,
  ) {
    const normalizedIds = [...new Set((packageStudyIds ?? []).filter(Boolean))];

    if (currentStudyId && normalizedIds.includes(currentStudyId)) {
      throw new BadRequestException(
        'Un paquete no puede incluirse a si mismo.',
      );
    }

    if (normalizedIds.length === 0) {
      return [];
    }

    const studies = await this.studyRepo.findByIds(normalizedIds);
    if (studies.length !== normalizedIds.length) {
      throw new NotFoundException('Uno o mas estudios del paquete no existen.');
    }

    const invalidStudy = studies.find(
      (study) =>
        !study.isActive ||
        study.status !== StudyStatus.ACTIVE ||
        study.type !== StudyType.STUDY,
    );

    if (invalidStudy) {
      throw new BadRequestException(
        'Los paquetes solo pueden incluir estudios individuales activos.',
      );
    }

    return normalizedIds;
  }

  /**
   * Búsqueda de estudios / paquetes
   */
  async search(
    search: string,
    type?: StudyType,
    status?: StudyStatus,
    page = 1,
    limit = 10,
  ) {
    const qb = this.studyRepo
      .createQueryBuilder('study')
      .where('study.isActive = :isActive', { isActive: true })
      .orderBy('study.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (type) {
      qb.andWhere('study.type = :type', { type });
    }

    if (status) {
      qb.andWhere('study.status = :status', { status });
    }

    const normalizedSearch = this.normalizeSearchValue(search);
    if (normalizedSearch) {
      const normalizedFields = [
        this.buildNormalizedSql('study.name'),
        this.buildNormalizedSql('study.code'),
        this.buildNormalizedSql('study.description'),
        this.buildNormalizedSql('study.method'),
        this.buildNormalizedSql('study.indicator'),
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

  /**
   * Verificar existencia por clave
   */
  async existsByCode(code: string) {
    const study = await this.studyRepo.findOne({
      where: { code, isActive: true },
      select: ['id'],
    });
    return { exists: !!study, studyId: study?.id ?? null };
  }

  /**
   * Crear estudio
   */
  async create(dto: CreateStudyDto) {
    const existing = await this.studyRepo.findOne({
      where: { code: dto.code },
    });

    if (existing) {
      throw new ConflictException('Ya existe un estudio con esta clave.');
    }

    const packageStudyIds =
      dto.type === StudyType.PACKAGE
        ? await this.validatePackageStudyIds(dto.packageStudyIds)
        : [];

    const entity = this.studyRepo.create({
      ...dto,
      packageStudyIds,
      normalPrice: dto.normalPrice,
      difPrice: dto.difPrice,
      specialPrice: dto.specialPrice,
      hospitalPrice: dto.hospitalPrice,
      otherPrice: dto.otherPrice,
      defaultDiscountPercent: dto.defaultDiscountPercent,
    });

    return this.studyRepo.save(entity);
  }

  /**
   * Obtener un estudio
   */
  async findOne(id: number) {
    const study = await this.studyRepo.findOne({
      where: { id, isActive: true },
    });
    if (!study) {
      throw new NotFoundException('Estudio no encontrado.');
    }
    return study;
  }

  /**
   * Actualizar estudio
   */
  async update(id: number, dto: UpdateStudyDto) {
    const study = await this.findOne(id);

    if (dto.code && dto.code !== study.code) {
      const existing = await this.studyRepo.findOne({
        where: { code: dto.code },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Ya existe otro estudio con esta clave.');
      }
    }

    const nextType = dto.type ?? study.type;
    const packageStudyIds =
      nextType === StudyType.PACKAGE
        ? await this.validatePackageStudyIds(
            dto.packageStudyIds ?? study.packageStudyIds,
            id,
          )
        : [];

    const merged = this.studyRepo.merge(study, {
      ...dto,
      packageStudyIds,
      normalPrice: dto.normalPrice ?? study.normalPrice,
      difPrice: dto.difPrice ?? study.difPrice,
      specialPrice: dto.specialPrice ?? study.specialPrice,
      hospitalPrice: dto.hospitalPrice ?? study.hospitalPrice,
      otherPrice: dto.otherPrice ?? study.otherPrice,
      defaultDiscountPercent:
        dto.defaultDiscountPercent ?? study.defaultDiscountPercent,
    });
    return this.studyRepo.save(merged);
  }

  /**
   * Baja lógica de estudio
   */
  async softDelete(id: number) {
    await this.findOne(id);
    await this.studyRepo.update({ id }, { isActive: false });
    return { message: 'Estudio desactivado correctamente.' };
  }

  /**
   * Eliminación física
   */
  async hardDelete(id: number) {
    const result = await this.studyRepo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Estudio no encontrado.');
    }

    return {
      message: 'Estudio eliminado definitivamente de la base de datos.',
    };
  }

  // -------- DETALLES DE ESTUDIO --------

  /**
   * Listar detalles de un estudio (categorías y parámetros)
   */
  async listDetails(studyId: number) {
    const study = await this.findOne(studyId);

    if (study.type === StudyType.PACKAGE) {
      return [];
    }

    const details = await this.detailRepo.find({
      where: { studyId },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    return details;
  }

  /**
   * Crear detalle para un estudio
   */
  async createDetail(studyId: number, dto: CreateStudyDetailDto) {
    const study = await this.findOne(studyId);

    if (study.type === StudyType.PACKAGE) {
      throw new BadRequestException(
        'Los paquetes no definen parametros directos. Agrega estudios al paquete.',
      );
    }

    if (dto.parentId) {
      const parent = await this.detailRepo.findOne({
        where: { id: dto.parentId, studyId, isActive: true },
      });
      if (!parent) {
        throw new NotFoundException(
          'El detalle padre no existe en este estudio.',
        );
      }
    }

    const entity = this.detailRepo.create({
      ...dto,
      studyId,
    });

    return this.detailRepo.save(entity);
  }

  /**
   * Actualizar detalle
   */
  async updateDetail(detailId: number, dto: UpdateStudyDetailDto) {
    const detail = await this.detailRepo.findOne({
      where: { id: detailId },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    const study = await this.findOne(detail.studyId);
    if (study.type === StudyType.PACKAGE) {
      throw new BadRequestException(
        'Los paquetes no administran parametros directos.',
      );
    }

    if (dto.parentId) {
      const parent = await this.detailRepo.findOne({
        where: { id: dto.parentId, studyId: detail.studyId, isActive: true },
      });
      if (!parent) {
        throw new NotFoundException(
          'El detalle padre no existe en este estudio.',
        );
      }
    }

    const merged = this.detailRepo.merge(detail, dto);
    return this.detailRepo.save(merged);
  }

  async updateDetailStatus(detailId: number, dto: UpdateStudyDetailStatusDto) {
    const detail = await this.detailRepo.findOne({
      where: { id: detailId },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    if (detail.isActive === dto.isActive) {
      return detail;
    }

    detail.isActive = dto.isActive;
    return this.detailRepo.save(detail);
  }

  /**
   * Baja lógica de un detalle
   */
  async softDeleteDetail(detailId: number) {
    const detail = await this.detailRepo.findOne({
      where: { id: detailId, isActive: true },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }
    await this.detailRepo.update({ id: detailId }, { isActive: false });
    return { message: 'Detalle de estudio desactivado correctamente.' };
  }

  /**
   * Eliminación física de un detalle
   */
  async hardDeleteDetail(detailId: number) {
    const result = await this.detailRepo.delete({ id: detailId });

    if (result.affected === 0) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    return { message: 'Detalle de estudio eliminado definitivamente.' };
  }
}
