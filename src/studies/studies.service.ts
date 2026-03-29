import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { getLabDateToken } from '../common/utils/lab-date.util';
import { Study, StudyStatus, StudyType } from './entities/study.entity';
import { StudyDetail } from './entities/study-detail.entity';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { CreateStudyDetailDto } from './dto/create-study-detail.dto';
import { UpdateStudyDetailDto } from './dto/update-study-detail.dto';
import { UpdateStudyDetailStatusDto } from './dto/update-study-detail-status.dto';
import { DatabaseDialectService } from '../database/database-dialect.service';
import { RuntimePolicyService } from '../runtime/runtime-policy.service';

const LAB_TIME_ZONE = 'America/Mexico_City';
const AUTO_SEQUENCE_PAD = 4;
const AUTO_STUDY_CODE_PREFIX: Record<StudyType, string> = {
  [StudyType.STUDY]: 'EST',
  [StudyType.PACKAGE]: 'PAQ',
  [StudyType.OTHER]: 'OTR',
};

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
    private readonly databaseDialect: DatabaseDialectService,
    private readonly runtimePolicy: RuntimePolicyService,
  ) {}

  private normalizeSearchValue(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private buildNormalizedSql(field: string) {
    return this.databaseDialect.buildCompactSearchExpression(field);
    return `regexp_replace(lower(translate(coalesce(${field}, ''), 'áéíóúäëïöüàèìòùÁÉÍÓÚÄËÏÖÜÀÈÌÒÙñÑ', 'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN')), '[^a-z0-9]+', '', 'g')`;
  }

  private getLabDateToken(date = new Date()) {
    return getLabDateToken(LAB_TIME_ZONE, date);
  }

  private buildAutoStudyCode(
    type: StudyType,
    sequence: number,
    date = new Date(),
  ) {
    return `${AUTO_STUDY_CODE_PREFIX[type]}${this.getLabDateToken(date)}${String(sequence).padStart(AUTO_SEQUENCE_PAD, '0')}`;
  }

  private extractAutoSequenceValue(
    value: string | null | undefined,
    type: StudyType,
    dateToken: string,
  ) {
    if (!value) return 0;

    const match = new RegExp(
      `^${AUTO_STUDY_CODE_PREFIX[type]}${dateToken}(\\d{${AUTO_SEQUENCE_PAD}})$`,
      'i',
    ).exec(value.trim());

    return match ? Number(match[1]) : 0;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === '23505'
    );
  }

  private async getNextAutoStudyCode(type: StudyType, date = new Date()) {
    const dateToken = this.getLabDateToken(date);
    const prefix = `${AUTO_STUDY_CODE_PREFIX[type]}${dateToken}%`;

    const latest = await this.studyRepo
      .createQueryBuilder('study')
      .where('study.code LIKE :prefix', { prefix })
      .andWhere(
        `${this.databaseDialect.getDateTokenExpression(LAB_TIME_ZONE, 'study.createdAt')} = :dateToken`,
        { dateToken },
      )
      .orderBy('study.code', 'DESC')
      .getOne();

    const nextSequence =
      this.extractAutoSequenceValue(latest?.code, type, dateToken) + 1;

    return this.buildAutoStudyCode(type, nextSequence, date);
  }

  private normalizeStudyCode(code?: string | null) {
    const normalized = code?.trim().toUpperCase();
    return normalized ? normalized : null;
  }

  private async findDuplicateStudyByName(
    name: string,
    type: StudyType,
    excludeId?: number,
  ) {
    const normalizedName = this.normalizeSearchValue(name);

    if (!normalizedName) {
      return null;
    }

    const qb = this.studyRepo
      .createQueryBuilder('study')
      .where('study.type = :type', { type })
      .andWhere(`${this.buildNormalizedSql('study.name')} = :name`, {
        name: normalizedName,
      });

    if (excludeId) {
      qb.andWhere('study.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async assertNoDuplicateStudyName(
    name: string,
    type: StudyType,
    excludeId?: number,
  ) {
    const duplicate = await this.findDuplicateStudyByName(
      name,
      type,
      excludeId,
    );

    if (duplicate) {
      throw new ConflictException(
        'Ya existe otro registro con el mismo nombre dentro de este tipo.',
      );
    }
  }

  private async findActiveStudyOrFail(id: number) {
    const study = await this.studyRepo.findOne({
      where: { id, isActive: true },
    });

    if (!study) {
      throw new NotFoundException('Estudio no encontrado.');
    }

    return study;
  }

  private async findDetailOrFail(detailId: number, activeOnly = false) {
    const detail = await this.detailRepo.findOne({
      where: activeOnly ? { id: detailId, isActive: true } : { id: detailId },
    });

    if (!detail) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    return detail;
  }

  private ensureStudyAllowsDirectDetails(study: Study, message: string) {
    if (study.type === StudyType.PACKAGE) {
      throw new BadRequestException(message);
    }
  }

  private async assertParentDetailExists(
    studyId: number,
    parentId?: number | null,
  ) {
    if (parentId === undefined || parentId === null) {
      return;
    }

    const parent = await this.detailRepo.findOne({
      where: { id: parentId, studyId, isActive: true },
    });

    if (!parent) {
      throw new NotFoundException(
        'El detalle padre no existe en este estudio.',
      );
    }
  }

  async getSuggestedCode(type: StudyType = StudyType.STUDY) {
    return { code: await this.getNextAutoStudyCode(type) };
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
    const normalizedCode = this.normalizeStudyCode(code);
    if (!normalizedCode) {
      return { exists: false, studyId: null };
    }

    const study = await this.studyRepo.findOne({
      where: { code: normalizedCode, isActive: true },
      select: ['id'],
    });
    return { exists: !!study, studyId: study?.id ?? null };
  }

  /**
   * Crear estudio
   */
  async create(dto: CreateStudyDto) {
    const packageStudyIds =
      dto.type === StudyType.PACKAGE
        ? await this.validatePackageStudyIds(dto.packageStudyIds)
        : [];
    await this.assertNoDuplicateStudyName(dto.name, dto.type);

    const manualCode = this.normalizeStudyCode(dto.code);
    const useAutoCode = dto.autoGenerateCode ?? false;

    if (!useAutoCode && !manualCode) {
      throw new BadRequestException(
        'La clave es obligatoria o activa la generacion automatica.',
      );
    }

    const saveStudy = async (code: string) => {
      const entity = this.studyRepo.create({
        ...dto,
        code,
        packageStudyIds,
        normalPrice: dto.normalPrice,
        difPrice: dto.difPrice,
        specialPrice: dto.specialPrice,
        hospitalPrice: dto.hospitalPrice,
        otherPrice: dto.otherPrice,
        defaultDiscountPercent: dto.defaultDiscountPercent,
      });

      return this.studyRepo.save(entity);
    };

    if (!useAutoCode && manualCode) {
      const existing = await this.studyRepo.findOne({
        where: { code: manualCode },
      });

      if (existing) {
        throw new ConflictException('Ya existe un estudio con esta clave.');
      }

      try {
        return await saveStudy(manualCode);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Ya existe un estudio con esta clave.');
        }

        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextCode = await this.getNextAutoStudyCode(dto.type);

      try {
        return await saveStudy(nextCode);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'No se pudo generar una clave automatica. Intenta de nuevo.',
    );
  }

  /**
   * Obtener un estudio
   */
  async findOne(id: number) {
    return this.findActiveStudyOrFail(id);
  }

  /**
   * Actualizar estudio
   */
  async update(id: number, dto: UpdateStudyDto) {
    const study = await this.findOne(id);
    const nextType = dto.type ?? study.type;
    const nextName = dto.name ?? study.name;
    const manualCode = this.normalizeStudyCode(dto.code);
    const useAutoCode = dto.autoGenerateCode ?? false;

    await this.assertNoDuplicateStudyName(nextName, nextType, id);

    if (!useAutoCode && manualCode && manualCode !== study.code) {
      const existing = await this.studyRepo.findOne({
        where: { code: manualCode },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Ya existe otro estudio con esta clave.');
      }
    }

    const packageStudyIds =
      nextType === StudyType.PACKAGE
        ? await this.validatePackageStudyIds(
            dto.packageStudyIds ?? study.packageStudyIds,
            id,
          )
        : [];

    const saveStudy = async (code: string) => {
      const merged = this.studyRepo.merge(study, {
        ...dto,
        code,
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
    };

    if (!useAutoCode) {
      try {
        return await saveStudy(manualCode ?? study.code);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Ya existe otro estudio con esta clave.');
        }

        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextCode = await this.getNextAutoStudyCode(nextType);

      try {
        return await saveStudy(nextCode);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'No se pudo generar una clave automatica. Intenta de nuevo.',
    );
  }

  /**
   * Baja lógica de estudio
   */
  async softDelete(id: number) {
    const study = await this.findOne(id);
    study.isActive = false;
    study.deletedAt = new Date();
    await this.studyRepo.save(study);
    return { message: 'Estudio desactivado correctamente.' };
  }

  /**
   * Eliminación física
   */
  async hardDelete(id: number) {
    this.runtimePolicy.assertHardDeleteAllowed('estudios');
    const study = await this.findOne(id);
    await this.studyRepo.remove(study);

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
    this.ensureStudyAllowsDirectDetails(
      study,
      'Los paquetes no definen parametros directos. Agrega estudios al paquete.',
    );
    await this.assertParentDetailExists(studyId, dto.parentId);

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
    const detail = await this.findDetailOrFail(detailId);

    const study = await this.findOne(detail.studyId);
    this.ensureStudyAllowsDirectDetails(
      study,
      'Los paquetes no administran parametros directos.',
    );
    await this.assertParentDetailExists(detail.studyId, dto.parentId);

    const merged = this.detailRepo.merge(detail, dto);
    return this.detailRepo.save(merged);
  }

  async updateDetailStatus(detailId: number, dto: UpdateStudyDetailStatusDto) {
    const detail = await this.findDetailOrFail(detailId);

    if (detail.isActive === dto.isActive) {
      return detail;
    }

    detail.isActive = dto.isActive;
    detail.deletedAt = dto.isActive ? null : new Date();
    return this.detailRepo.save(detail);
  }

  /**
   * Baja lógica de un detalle
   */
  async softDeleteDetail(detailId: number) {
    const detail = await this.findDetailOrFail(detailId, true);
    detail.isActive = false;
    detail.deletedAt = new Date();
    await this.detailRepo.save(detail);
    return { message: 'Detalle de estudio desactivado correctamente.' };
  }

  /**
   * Eliminación física de un detalle
   */
  async hardDeleteDetail(detailId: number) {
    this.runtimePolicy.assertHardDeleteAllowed(
      'detalles de estudio',
    );
    const detail = await this.findDetailOrFail(detailId, true);
    await this.detailRepo.remove(detail);

    return { message: 'Detalle de estudio eliminado definitivamente.' };
  }
}
