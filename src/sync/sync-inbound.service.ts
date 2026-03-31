import { Injectable } from '@nestjs/common';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Patient, PatientGender } from '../patients/entities/patient.entity';
import { User } from '../users/entities/user.entity';
import {
  ServiceOrder,
  ServiceOrderItem,
  ServiceItemPriceType,
  ServiceStatus,
} from '../services/entities/service-order.entity';
import {
  StudyResult,
  StudyResultValue,
} from '../results/entities/study-result.entity';
import { SyncOutboxOperation } from './entities/sync-outbox-event.entity';
import {
  markSyncEntityForRemoteApply,
  SYNC_OUTBOX_SKIP_FLAG,
} from './sync-entity.util';
import {
  MissingSyncDependencyError,
  requireLocalIdByPublicId,
  sortSyncMutationsByResource,
  isSupportedInboundSyncResourceType,
} from './sync-resource.util';
import {
  Study,
  StudyStatus,
  StudyType,
} from '../studies/entities/study.entity';
import {
  StudyDetail,
  StudyDetailType,
} from '../studies/entities/study-detail.entity';
import type { SyncInboundMutationInput } from './dto/apply-sync-mutations.dto';
import { Role } from '../common/enums/roles.enum';

type ApplyMutationStatus =
  | 'applied'
  | 'skipped_stale'
  | 'skipped_duplicate'
  | 'deferred_missing_dependency'
  | 'failed'
  | 'unsupported_resource';

type ApplyMutationResult = {
  index: number;
  resourceType: string;
  operation: SyncOutboxOperation;
  publicId: string | null;
  status: ApplyMutationStatus;
  localId: number | null;
  message: string;
};

function toOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toOptionalDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
}

function createResult(
  base: Pick<
    ApplyMutationResult,
    'index' | 'resourceType' | 'operation' | 'publicId'
  >,
  status: ApplyMutationStatus,
  message: string,
  localId: number | null,
): ApplyMutationResult {
  return {
    ...base,
    status,
    message,
    localId,
  };
}

@Injectable()
export class SyncInboundService {
  constructor(private readonly dataSource: DataSource) {}

  async applyBatch(mutations: SyncInboundMutationInput[]) {
    const sorted = sortSyncMutationsByResource(
      mutations.map((mutation, index) => ({
        ...mutation,
        index,
      })),
    );

    const results = new Map<number, ApplyMutationResult>();
    let pending = sorted;

    while (pending.length > 0) {
      let appliedInPass = false;
      const nextPending: typeof pending = [];

      for (const mutation of pending) {
        const result = await this.applySingleMutation(mutation);

        if (result.status === 'deferred_missing_dependency') {
          nextPending.push(mutation);
          continue;
        }

        results.set(mutation.index, result);
        appliedInPass = true;
      }

      if (nextPending.length === 0) {
        break;
      }

      if (!appliedInPass) {
        for (const mutation of nextPending) {
          results.set(
            mutation.index,
            createResult(
              {
                index: mutation.index,
                resourceType: mutation.resourceType,
                operation: mutation.operation,
                publicId: toOptionalString(mutation.payload.publicId),
              },
              'deferred_missing_dependency',
              'La mutacion sigue esperando dependencias no disponibles localmente.',
              null,
            ),
          );
        }
        break;
      }

      pending = nextPending;
    }

    const orderedResults = mutations.map((_, index) => results.get(index)!);

    return {
      total: orderedResults.length,
      appliedCount: orderedResults.filter((result) => result.status === 'applied')
        .length,
      skippedCount: orderedResults.filter((result) =>
        ['skipped_stale', 'skipped_duplicate'].includes(result.status),
      ).length,
      deferredCount: orderedResults.filter(
        (result) => result.status === 'deferred_missing_dependency',
      ).length,
      failedCount: orderedResults.filter((result) =>
        ['failed', 'unsupported_resource'].includes(result.status),
      ).length,
      results: orderedResults,
    };
  }

  private async applySingleMutation(
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const publicId = toOptionalString(mutation.payload.publicId);

    if (!isSupportedInboundSyncResourceType(mutation.resourceType)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'unsupported_resource',
        `El recurso ${mutation.resourceType} aun no esta soportado para sync inbound.`,
        null,
      );
    }

    try {
      return await this.dataSource.transaction(async (manager) =>
        this.withInboundContext(manager, () =>
          this.applySupportedMutation(manager, mutation),
        ),
      );
    } catch (error) {
      if (error instanceof MissingSyncDependencyError) {
        return createResult(
          {
            index: mutation.index,
            resourceType: mutation.resourceType,
            operation: mutation.operation,
            publicId,
          },
          'deferred_missing_dependency',
          error.message,
          null,
        );
      }

      const message =
        error instanceof Error ? error.message : 'No se pudo aplicar la mutacion.';

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'failed',
        message,
        null,
      );
    }
  }

  private async withInboundContext<T>(
    manager: EntityManager,
    work: () => Promise<T>,
  ) {
    const queryRunner = manager.queryRunner;
    if (!queryRunner) {
      return work();
    }

    const currentData =
      typeof queryRunner.data === 'object' && queryRunner.data !== null
        ? queryRunner.data
        : {};
    const previousFlag = currentData[SYNC_OUTBOX_SKIP_FLAG];

    currentData[SYNC_OUTBOX_SKIP_FLAG] = true;
    queryRunner.data = currentData;

    try {
      return await work();
    } finally {
      if (previousFlag === undefined) {
        delete currentData[SYNC_OUTBOX_SKIP_FLAG];
      } else {
        currentData[SYNC_OUTBOX_SKIP_FLAG] = previousFlag;
      }

      queryRunner.data = currentData;
    }
  }

  private async applySupportedMutation(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    switch (mutation.resourceType) {
      case 'users':
        return this.applyUser(manager, mutation);
      case 'patients':
        return this.applyPatient(manager, mutation);
      case 'doctors':
        return this.applyDoctor(manager, mutation);
      case 'studies':
        return this.applyStudy(manager, mutation);
      case 'study_details':
        return this.applyStudyDetail(manager, mutation);
      case 'service_orders':
        return this.applyServiceOrder(manager, mutation);
      case 'service_order_items':
        return this.applyServiceOrderItem(manager, mutation);
      case 'study_results':
        return this.applyStudyResult(manager, mutation);
      case 'study_result_values':
        return this.applyStudyResultValue(manager, mutation);
      default:
        throw new Error(`Recurso ${mutation.resourceType} no soportado.`);
    }
  }

  private shouldSkipMutation(currentVersion: number, incomingVersion: number) {
    return currentVersion > incomingVersion;
  }

  private async confirmEntitySyncState<TEntity extends { id: number | string }>(
    repo: Repository<TEntity>,
    entity: TEntity & {
      lastSyncedVersion?: number | null;
      lastSyncedAt?: Date | null;
    },
    incomingVersion: number,
  ) {
    const currentLastSyncedVersion = Math.max(
      0,
      Number(entity.lastSyncedVersion ?? 0),
    );

    if (
      currentLastSyncedVersion >= incomingVersion &&
      entity.lastSyncedAt instanceof Date
    ) {
      return;
    }

    const syncedAt = new Date();
    await repo.update(
      { id: entity.id } as never,
      {
        lastSyncedVersion: Math.max(currentLastSyncedVersion, incomingVersion),
        lastSyncedAt: syncedAt,
      } as never,
    );

    entity.lastSyncedVersion = Math.max(
      currentLastSyncedVersion,
      incomingVersion,
    );
    entity.lastSyncedAt = syncedAt;
  }

  private isDuplicateMutation(
    currentVersion: number,
    incomingVersion: number,
    currentDeletedAt: Date | null | undefined,
    incomingDeletedAt: Date | null,
  ) {
    return (
      currentVersion === incomingVersion &&
      (currentDeletedAt?.toISOString() ?? null) ===
        (incomingDeletedAt?.toISOString() ?? null)
    );
  }

  private async applyUser(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(User);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de usuario requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const incomingDeletedAt =
      mutation.operation === SyncOutboxOperation.DELETE
        ? toOptionalDate(mutation.payload.deletedAt) ?? new Date()
        : toOptionalDate(mutation.payload.deletedAt);

    const existing = await repo.findOne({ where: { publicId } });

    if (mutation.operation === SyncOutboxOperation.DELETE) {
      if (!existing) {
        return createResult(
          {
            index: mutation.index,
            resourceType: mutation.resourceType,
            operation: mutation.operation,
            publicId,
          },
          'skipped_duplicate',
          'El usuario ya no existe localmente.',
          null,
        );
      }

      if (this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
        return createResult(
          {
            index: mutation.index,
            resourceType: mutation.resourceType,
            operation: mutation.operation,
            publicId,
          },
          'skipped_stale',
          'La mutacion ya fue superada por una version local mas reciente.',
          Number(existing.id),
        );
      }

      await repo.remove(existing);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'applied',
        'Usuario eliminado correctamente.',
        Number(existing.id),
      );
    }

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        Number(existing.id),
      );
    }

    if (
      existing &&
      this.isDuplicateMutation(
        existing.syncVersion,
        incomingVersion,
        existing.deletedAt,
        incomingDeletedAt,
      )
    ) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        Number(existing.id),
      );
    }

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: incomingDeletedAt,
      nombre: toOptionalString(mutation.payload.nombre) ?? '',
      email: toOptionalString(mutation.payload.email)?.toLowerCase() ?? '',
      password: toOptionalString(mutation.payload.password) ?? '',
      token: toOptionalString(mutation.payload.token),
      confirmed: toBoolean(mutation.payload.confirmed, false),
      rol:
        (toOptionalString(mutation.payload.rol) as Role | null) ??
        Role.Unassigned,
      profileImageData:
        toOptionalString(mutation.payload.profileImageData) ?? null,
      profileImageMimeType:
        toOptionalString(mutation.payload.profileImageMimeType) ?? null,
      googleAvatarUrl:
        toOptionalString(mutation.payload.googleAvatarUrl) ?? null,
      resetTokenExpiresAt: toOptionalDate(
        mutation.payload.resetTokenExpiresAt,
      ),
      resetRequestCount:
        Math.max(
          0,
          Math.trunc(toOptionalNumber(mutation.payload.resetRequestCount) ?? 0),
        ) ?? 0,
      resetRequestWindowStart: toOptionalDate(
        mutation.payload.resetRequestWindowStart,
      ),
      failedLoginAttempts: Math.max(
        0,
        Math.trunc(toOptionalNumber(mutation.payload.failedLoginAttempts) ?? 0),
      ),
      lockUntil: toOptionalDate(mutation.payload.lockUntil),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Usuario sincronizado correctamente.',
      Number(saved.id),
    );
  }

  private async applyPatient(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(Patient);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de paciente requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const incomingDeletedAt =
      mutation.operation === SyncOutboxOperation.DELETE
        ? toOptionalDate(mutation.payload.deletedAt) ?? new Date()
        : toOptionalDate(mutation.payload.deletedAt);

    const existing = await repo.findOne({ where: { publicId } });

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    if (
      existing &&
      this.isDuplicateMutation(
        existing.syncVersion,
        incomingVersion,
        existing.deletedAt,
        incomingDeletedAt,
      )
    ) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: incomingDeletedAt,
      firstName: toOptionalString(mutation.payload.firstName) ?? '',
      lastName: toOptionalString(mutation.payload.lastName) ?? '',
      middleName: toOptionalString(mutation.payload.middleName) ?? undefined,
      gender:
        (toOptionalString(mutation.payload.gender) as PatientGender | null) ??
        PatientGender.OTHER,
      birthDate: toOptionalString(mutation.payload.birthDate) ?? '1900-01-01',
      phone: toOptionalString(mutation.payload.phone) ?? undefined,
      email: toOptionalString(mutation.payload.email) ?? undefined,
      addressLine: toOptionalString(mutation.payload.addressLine) ?? undefined,
      addressBetween:
        toOptionalString(mutation.payload.addressBetween) ?? undefined,
      addressCity: toOptionalString(mutation.payload.addressCity) ?? undefined,
      addressState: toOptionalString(mutation.payload.addressState) ?? undefined,
      addressZip: toOptionalString(mutation.payload.addressZip) ?? undefined,
      documentType: toOptionalString(mutation.payload.documentType) ?? undefined,
      documentNumber:
        toOptionalString(mutation.payload.documentNumber) ?? undefined,
      isActive:
        mutation.operation === SyncOutboxOperation.DELETE
          ? false
          : toBoolean(mutation.payload.isActive, incomingDeletedAt == null),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Paciente sincronizado correctamente.',
      saved.id,
    );
  }

  private async applyDoctor(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(Doctor);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de medico requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const incomingDeletedAt =
      mutation.operation === SyncOutboxOperation.DELETE
        ? toOptionalDate(mutation.payload.deletedAt) ?? new Date()
        : toOptionalDate(mutation.payload.deletedAt);

    const existing = await repo.findOne({ where: { publicId } });

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    if (
      existing &&
      this.isDuplicateMutation(
        existing.syncVersion,
        incomingVersion,
        existing.deletedAt,
        incomingDeletedAt,
      )
    ) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: incomingDeletedAt,
      firstName: toOptionalString(mutation.payload.firstName) ?? '',
      lastName: toOptionalString(mutation.payload.lastName) ?? '',
      middleName: toOptionalString(mutation.payload.middleName) ?? undefined,
      email: toOptionalString(mutation.payload.email) ?? undefined,
      phone: toOptionalString(mutation.payload.phone) ?? undefined,
      specialty: toOptionalString(mutation.payload.specialty) ?? undefined,
      licenseNumber:
        toOptionalString(mutation.payload.licenseNumber) ?? undefined,
      notes: toOptionalString(mutation.payload.notes) ?? undefined,
      isActive:
        mutation.operation === SyncOutboxOperation.DELETE
          ? false
          : toBoolean(mutation.payload.isActive, incomingDeletedAt == null),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Medico sincronizado correctamente.',
      saved.id,
    );
  }

  private async applyStudy(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(Study);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de estudio requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const incomingDeletedAt =
      mutation.operation === SyncOutboxOperation.DELETE
        ? toOptionalDate(mutation.payload.deletedAt) ?? new Date()
        : toOptionalDate(mutation.payload.deletedAt);
    const packageStudyPublicIds = toStringArray(
      mutation.payload.packageStudyPublicIds,
    );

    const existing = await repo.findOne({ where: { publicId } });

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    if (
      existing &&
      this.isDuplicateMutation(
        existing.syncVersion,
        incomingVersion,
        existing.deletedAt,
        incomingDeletedAt,
      )
    ) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    const packageStudyIds: number[] = [];
    for (const packageStudyPublicId of packageStudyPublicIds) {
      const localId = await requireLocalIdByPublicId(
        manager,
        Study,
        packageStudyPublicId,
        'study',
        mutation.resourceType,
      );

      if (localId) {
        packageStudyIds.push(localId);
      }
    }

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: incomingDeletedAt,
      name: toOptionalString(mutation.payload.name) ?? '',
      code: toOptionalString(mutation.payload.code) ?? '',
      description: toOptionalString(mutation.payload.description) ?? undefined,
      durationMinutes: Math.trunc(
        toOptionalNumber(mutation.payload.durationMinutes) ?? 60,
      ),
      type:
        (toOptionalString(mutation.payload.type) as StudyType | null) ??
        StudyType.STUDY,
      normalPrice: toOptionalNumber(mutation.payload.normalPrice) ?? 0,
      difPrice: toOptionalNumber(mutation.payload.difPrice) ?? 0,
      specialPrice: toOptionalNumber(mutation.payload.specialPrice) ?? 0,
      hospitalPrice: toOptionalNumber(mutation.payload.hospitalPrice) ?? 0,
      otherPrice: toOptionalNumber(mutation.payload.otherPrice) ?? 0,
      defaultDiscountPercent:
        toOptionalNumber(mutation.payload.defaultDiscountPercent) ?? 0,
      method: toOptionalString(mutation.payload.method) ?? undefined,
      indicator: toOptionalString(mutation.payload.indicator) ?? undefined,
      packageStudyIds,
      status:
        (toOptionalString(mutation.payload.status) as StudyStatus | null) ??
        StudyStatus.ACTIVE,
      isActive:
        mutation.operation === SyncOutboxOperation.DELETE
          ? false
          : toBoolean(mutation.payload.isActive, incomingDeletedAt == null),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Estudio sincronizado correctamente.',
      saved.id,
    );
  }

  private async applyStudyDetail(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(StudyDetail);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error(
        'La mutacion de detalle de estudio requiere publicId.',
      );
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const incomingDeletedAt =
      mutation.operation === SyncOutboxOperation.DELETE
        ? toOptionalDate(mutation.payload.deletedAt) ?? new Date()
        : toOptionalDate(mutation.payload.deletedAt);

    const existing = await repo.findOne({ where: { publicId } });

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    if (
      existing &&
      this.isDuplicateMutation(
        existing.syncVersion,
        incomingVersion,
        existing.deletedAt,
        incomingDeletedAt,
      )
    ) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    const studyId = await requireLocalIdByPublicId(
      manager,
      Study,
      toOptionalString(mutation.payload.studyPublicId),
      'study',
      mutation.resourceType,
    );
    const parentId = await requireLocalIdByPublicId(
      manager,
      StudyDetail,
      toOptionalString(mutation.payload.parentPublicId),
      'parent detail',
      mutation.resourceType,
    );

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: incomingDeletedAt,
      studyId: studyId ?? entity.studyId,
      parentId,
      dataType:
        (toOptionalString(mutation.payload.dataType) as StudyDetailType | null) ??
        StudyDetailType.PARAMETER,
      name: toOptionalString(mutation.payload.name) ?? '',
      sortOrder: Math.trunc(toOptionalNumber(mutation.payload.sortOrder) ?? 1),
      unit: toOptionalString(mutation.payload.unit) ?? undefined,
      referenceValue:
        toOptionalString(mutation.payload.referenceValue) ?? undefined,
      isActive:
        mutation.operation === SyncOutboxOperation.DELETE
          ? false
          : toBoolean(mutation.payload.isActive, incomingDeletedAt == null),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Detalle de estudio sincronizado correctamente.',
      saved.id,
    );
  }

  private async applyServiceOrder(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(ServiceOrder);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de servicio requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const incomingDeletedAt =
      mutation.operation === SyncOutboxOperation.DELETE
        ? toOptionalDate(mutation.payload.deletedAt) ?? new Date()
        : toOptionalDate(mutation.payload.deletedAt);

    const existing = await repo.findOne({ where: { publicId } });

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    if (
      existing &&
      this.isDuplicateMutation(
        existing.syncVersion,
        incomingVersion,
        existing.deletedAt,
        incomingDeletedAt,
      )
    ) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    const patientId = await requireLocalIdByPublicId(
      manager,
      Patient,
      toOptionalString(mutation.payload.patientPublicId),
      'patient',
      mutation.resourceType,
    );
    const doctorId = await requireLocalIdByPublicId(
      manager,
      Doctor,
      toOptionalString(mutation.payload.doctorPublicId),
      'doctor',
      mutation.resourceType,
    );

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: incomingDeletedAt,
      folio: toOptionalString(mutation.payload.folio) ?? '',
      patientId: patientId ?? entity.patientId,
      doctorId: doctorId ?? undefined,
      branchName: toOptionalString(mutation.payload.branchName) ?? undefined,
      sampleAt: toOptionalDate(mutation.payload.sampleAt) ?? undefined,
      deliveryAt: toOptionalDate(mutation.payload.deliveryAt) ?? undefined,
      completedAt: toOptionalDate(mutation.payload.completedAt) ?? undefined,
      status:
        (toOptionalString(mutation.payload.status) as ServiceStatus | null) ??
        ServiceStatus.PENDING,
      subtotalAmount: toOptionalNumber(mutation.payload.subtotalAmount) ?? 0,
      courtesyPercent: toOptionalNumber(mutation.payload.courtesyPercent) ?? 0,
      discountAmount: toOptionalNumber(mutation.payload.discountAmount) ?? 0,
      totalAmount: toOptionalNumber(mutation.payload.totalAmount) ?? 0,
      notes: toOptionalString(mutation.payload.notes) ?? undefined,
      isActive:
        mutation.operation === SyncOutboxOperation.DELETE
          ? false
          : toBoolean(mutation.payload.isActive, incomingDeletedAt == null),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Servicio sincronizado correctamente.',
      saved.id,
    );
  }

  private async applyServiceOrderItem(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(ServiceOrderItem);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de item de servicio requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const existing = await repo.findOne({ where: { publicId } });

    if (mutation.operation === SyncOutboxOperation.DELETE) {
      if (!existing) {
        return createResult(
          {
            index: mutation.index,
            resourceType: mutation.resourceType,
            operation: mutation.operation,
            publicId,
          },
          'skipped_duplicate',
          'El item ya no existe localmente.',
          null,
        );
      }

      if (this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
        return createResult(
          {
            index: mutation.index,
            resourceType: mutation.resourceType,
            operation: mutation.operation,
            publicId,
          },
          'skipped_stale',
          'La mutacion ya fue superada por una version local mas reciente.',
          existing.id,
        );
      }

      await repo.remove(existing);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'applied',
        'Item de servicio eliminado correctamente.',
        existing.id,
      );
    }

    if (existing && existing.syncVersion === incomingVersion) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    const serviceOrderId = await requireLocalIdByPublicId(
      manager,
      ServiceOrder,
      toOptionalString(mutation.payload.serviceOrderPublicId),
      'service order',
      mutation.resourceType,
    );
    const studyId = await requireLocalIdByPublicId(
      manager,
      Study,
      toOptionalString(mutation.payload.studyPublicId),
      'study',
      mutation.resourceType,
    );
    const sourcePackageId = await requireLocalIdByPublicId(
      manager,
      Study,
      toOptionalString(mutation.payload.sourcePackagePublicId),
      'source package',
      mutation.resourceType,
    );

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: null,
      serviceOrderId: serviceOrderId ?? entity.serviceOrderId,
      studyId: studyId ?? entity.studyId,
      studyNameSnapshot: toOptionalString(mutation.payload.studyNameSnapshot) ?? '',
      sourcePackageId: sourcePackageId ?? undefined,
      sourcePackageNameSnapshot:
        toOptionalString(mutation.payload.sourcePackageNameSnapshot) ?? undefined,
      priceType:
        (toOptionalString(
          mutation.payload.priceType,
        ) as ServiceOrderItem['priceType'] | null) ??
        ServiceItemPriceType.NORMAL,
      unitPrice: toOptionalNumber(mutation.payload.unitPrice) ?? 0,
      quantity: Math.trunc(toOptionalNumber(mutation.payload.quantity) ?? 1),
      discountPercent: toOptionalNumber(mutation.payload.discountPercent) ?? 0,
      subtotalAmount: toOptionalNumber(mutation.payload.subtotalAmount) ?? 0,
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Item de servicio sincronizado correctamente.',
      saved.id,
    );
  }

  private async applyStudyResult(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(StudyResult);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de resultado requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const incomingDeletedAt =
      mutation.operation === SyncOutboxOperation.DELETE
        ? toOptionalDate(mutation.payload.deletedAt) ?? new Date()
        : toOptionalDate(mutation.payload.deletedAt);

    const existing = await repo.findOne({ where: { publicId } });

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    if (
      existing &&
      this.isDuplicateMutation(
        existing.syncVersion,
        incomingVersion,
        existing.deletedAt,
        incomingDeletedAt,
      )
    ) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    const serviceOrderId = await requireLocalIdByPublicId(
      manager,
      ServiceOrder,
      toOptionalString(mutation.payload.serviceOrderPublicId),
      'service order',
      mutation.resourceType,
    );
    const serviceOrderItemId = await requireLocalIdByPublicId(
      manager,
      ServiceOrderItem,
      toOptionalString(mutation.payload.serviceOrderItemPublicId),
      'service order item',
      mutation.resourceType,
    );

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: incomingDeletedAt,
      serviceOrderId: serviceOrderId ?? entity.serviceOrderId,
      serviceOrderItemId: serviceOrderItemId ?? entity.serviceOrderItemId,
      sampleAt: toOptionalDate(mutation.payload.sampleAt) ?? undefined,
      reportedAt: toOptionalDate(mutation.payload.reportedAt) ?? undefined,
      method: toOptionalString(mutation.payload.method) ?? undefined,
      observations:
        toOptionalString(mutation.payload.observations) ?? undefined,
      isDraft: toBoolean(mutation.payload.isDraft, true),
      isActive:
        mutation.operation === SyncOutboxOperation.DELETE
          ? false
          : toBoolean(mutation.payload.isActive, incomingDeletedAt == null),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Resultado sincronizado correctamente.',
      saved.id,
    );
  }

  private async applyStudyResultValue(
    manager: EntityManager,
    mutation: SyncInboundMutationInput & { index: number },
  ) {
    const repo = manager.getRepository(StudyResultValue);
    const publicId = toOptionalString(mutation.payload.publicId);
    if (!publicId) {
      throw new Error('La mutacion de valor de resultado requiere publicId.');
    }

    const incomingVersion = Math.max(
      1,
      Math.trunc(toOptionalNumber(mutation.payload.syncVersion) ?? 1),
    );
    const existing = await repo.findOne({ where: { publicId } });

    if (mutation.operation === SyncOutboxOperation.DELETE) {
      if (!existing) {
        return createResult(
          {
            index: mutation.index,
            resourceType: mutation.resourceType,
            operation: mutation.operation,
            publicId,
          },
          'skipped_duplicate',
          'El valor ya no existe localmente.',
          null,
        );
      }

      if (this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
        return createResult(
          {
            index: mutation.index,
            resourceType: mutation.resourceType,
            operation: mutation.operation,
            publicId,
          },
          'skipped_stale',
          'La mutacion ya fue superada por una version local mas reciente.',
          existing.id,
        );
      }

      await repo.remove(existing);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'applied',
        'Valor de resultado eliminado correctamente.',
        existing.id,
      );
    }

    if (existing && existing.syncVersion === incomingVersion) {
      await this.confirmEntitySyncState(repo, existing, incomingVersion);

      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_duplicate',
        'La mutacion ya estaba aplicada localmente.',
        existing.id,
      );
    }

    if (existing && this.shouldSkipMutation(existing.syncVersion, incomingVersion)) {
      return createResult(
        {
          index: mutation.index,
          resourceType: mutation.resourceType,
          operation: mutation.operation,
          publicId,
        },
        'skipped_stale',
        'La mutacion ya fue superada por una version local mas reciente.',
        existing.id,
      );
    }

    const studyResultId = await requireLocalIdByPublicId(
      manager,
      StudyResult,
      toOptionalString(mutation.payload.studyResultPublicId),
      'study result',
      mutation.resourceType,
    );
    const studyDetailId = await requireLocalIdByPublicId(
      manager,
      StudyDetail,
      toOptionalString(mutation.payload.studyDetailPublicId),
      'study detail',
      mutation.resourceType,
    );

    const entity = markSyncEntityForRemoteApply(existing ?? repo.create());

    repo.merge(entity, {
      publicId,
      syncVersion: incomingVersion,
      lastSyncedVersion: incomingVersion,
      syncOrigin:
        toOptionalString(mutation.payload.syncOrigin) ??
        entity.syncOrigin ??
        'server',
      lastSyncedAt: new Date(),
      deletedAt: null,
      studyResultId: studyResultId ?? entity.studyResultId,
      studyDetailId: studyDetailId ?? undefined,
      label: toOptionalString(mutation.payload.label) ?? '',
      unit: toOptionalString(mutation.payload.unit) ?? undefined,
      referenceValue:
        toOptionalString(mutation.payload.referenceValue) ?? undefined,
      value: toOptionalString(mutation.payload.value) ?? undefined,
      sortOrder: Math.trunc(toOptionalNumber(mutation.payload.sortOrder) ?? 1),
      visible: toBoolean(mutation.payload.visible, true),
    });

    const saved = await repo.save(entity);

    return createResult(
      {
        index: mutation.index,
        resourceType: mutation.resourceType,
        operation: mutation.operation,
        publicId,
      },
      'applied',
      'Valor de resultado sincronizado correctamente.',
      saved.id,
    );
  }
}
