import { In, type EntityManager, type ObjectLiteral } from 'typeorm';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Patient } from '../patients/entities/patient.entity';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import {
  StudyResult,
  StudyResultValue,
} from '../results/entities/study-result.entity';
import { Study } from '../studies/entities/study.entity';
import { StudyDetail } from '../studies/entities/study-detail.entity';

export const SUPPORTED_INBOUND_SYNC_RESOURCES = [
  'patients',
  'doctors',
  'studies',
  'study_details',
  'service_orders',
  'service_order_items',
  'study_results',
  'study_result_values',
] as const;

export type SupportedInboundSyncResourceType =
  (typeof SUPPORTED_INBOUND_SYNC_RESOURCES)[number];

export const SYNC_TRACKED_RESOURCE_ENTITY_MAP: Record<
  SupportedInboundSyncResourceType,
  new () => ObjectLiteral
> = {
  patients: Patient,
  doctors: Doctor,
  studies: Study,
  study_details: StudyDetail,
  service_orders: ServiceOrder,
  service_order_items: ServiceOrderItem,
  study_results: StudyResult,
  study_result_values: StudyResultValue,
};

const SYNC_RESOURCE_ORDER = [
  'patients',
  'doctors',
  'studies',
  'study_details',
  'service_orders',
  'service_order_items',
  'study_results',
  'study_result_values',
] as const;

function toOptionalNumber(value: unknown) {
  if (value == null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toIntegerArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => toOptionalNumber(item))
    .filter((item): item is number => item !== undefined)
    .map((item) => Math.trunc(item));
}

async function findPublicIdByLocalId<TEntity extends { publicId: string | null }>(
  manager: EntityManager,
  entity: new () => TEntity,
  id?: number | null,
) {
  if (!id) {
    return null;
  }

  const found = await manager.getRepository(entity).findOne({
    where: { id } as never,
  });

  return found?.publicId ?? null;
}

async function findLocalIdByPublicId<TEntity extends { id: number }>(
  manager: EntityManager,
  entity: new () => TEntity,
  publicId?: string | null,
) {
  if (!publicId) {
    return null;
  }

  const found = await manager.getRepository(entity).findOne({
    where: { publicId } as never,
  });

  return found?.id ?? null;
}

async function resolvePackageStudyPublicIds(
  manager: EntityManager,
  packageStudyIds: unknown,
) {
  const ids = toIntegerArray(packageStudyIds);
  if (ids.length === 0) {
    return [];
  }

  const studies = await manager.getRepository(Study).find({
    where: {
      id: In(ids),
    },
  });

  const studyPublicIdsById = new Map(
    studies
      .filter((study) => Boolean(study.publicId))
      .map((study) => [study.id, study.publicId!] as const),
  );

  return ids
    .map((id) => studyPublicIdsById.get(id))
    .filter((publicId): publicId is string => Boolean(publicId));
}

export async function buildPortableSyncPayload(
  resourceType: string,
  payload: Record<string, unknown>,
  manager: EntityManager,
) {
  switch (resourceType) {
    case 'studies':
      return {
        ...payload,
        packageStudyPublicIds: await resolvePackageStudyPublicIds(
          manager,
          payload.packageStudyIds,
        ),
      };
    case 'study_details':
      return {
        ...payload,
        studyPublicId: await findPublicIdByLocalId(
          manager,
          Study,
          toOptionalNumber(payload.studyId),
        ),
        parentPublicId: await findPublicIdByLocalId(
          manager,
          StudyDetail,
          toOptionalNumber(payload.parentId),
        ),
      };
    case 'service_orders':
      return {
        ...payload,
        patientPublicId: await findPublicIdByLocalId(
          manager,
          Patient,
          toOptionalNumber(payload.patientId),
        ),
        doctorPublicId: await findPublicIdByLocalId(
          manager,
          Doctor,
          toOptionalNumber(payload.doctorId),
        ),
      };
    case 'service_order_items':
      return {
        ...payload,
        serviceOrderPublicId: await findPublicIdByLocalId(
          manager,
          ServiceOrder,
          toOptionalNumber(payload.serviceOrderId),
        ),
        studyPublicId: await findPublicIdByLocalId(
          manager,
          Study,
          toOptionalNumber(payload.studyId),
        ),
        sourcePackagePublicId: await findPublicIdByLocalId(
          manager,
          Study,
          toOptionalNumber(payload.sourcePackageId),
        ),
      };
    case 'study_results':
      return {
        ...payload,
        serviceOrderPublicId: await findPublicIdByLocalId(
          manager,
          ServiceOrder,
          toOptionalNumber(payload.serviceOrderId),
        ),
        serviceOrderItemPublicId: await findPublicIdByLocalId(
          manager,
          ServiceOrderItem,
          toOptionalNumber(payload.serviceOrderItemId),
        ),
      };
    case 'study_result_values':
      return {
        ...payload,
        studyResultPublicId: await findPublicIdByLocalId(
          manager,
          StudyResult,
          toOptionalNumber(payload.studyResultId),
        ),
        studyDetailPublicId: await findPublicIdByLocalId(
          manager,
          StudyDetail,
          toOptionalNumber(payload.studyDetailId),
        ),
      };
    default:
      return payload;
  }
}

export function isSupportedInboundSyncResourceType(
  value: string,
): value is SupportedInboundSyncResourceType {
  return (SUPPORTED_INBOUND_SYNC_RESOURCES as readonly string[]).includes(value);
}

export function getSyncTrackedResourceEntity(resourceType: string) {
  if (!isSupportedInboundSyncResourceType(resourceType)) {
    return null;
  }

  return SYNC_TRACKED_RESOURCE_ENTITY_MAP[resourceType];
}

export function sortSyncMutationsByResource<T extends { resourceType: string }>(
  items: T[],
) {
  const orderMap = new Map<string, number>(
    SYNC_RESOURCE_ORDER.map((resourceType, index) => [resourceType, index]),
  );

  return [...items].sort((left, right) => {
    const leftOrder = orderMap.get(left.resourceType) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      orderMap.get(right.resourceType) ?? Number.MAX_SAFE_INTEGER;

    return leftOrder - rightOrder;
  });
}

export class MissingSyncDependencyError extends Error {
  constructor(
    readonly resourceType: string,
    readonly dependencyName: string,
    readonly dependencyPublicId: string,
  ) {
    super(
      `No se pudo aplicar ${resourceType}: falta ${dependencyName} con publicId ${dependencyPublicId}.`,
    );
  }
}

export async function requireLocalIdByPublicId<TEntity extends { id: number }>(
  manager: EntityManager,
  entity: new () => TEntity,
  publicId: string | null | undefined,
  dependencyName: string,
  resourceType: string,
) {
  if (!publicId) {
    return null;
  }

  const localId = await findLocalIdByPublicId(manager, entity, publicId);

  if (!localId) {
    throw new MissingSyncDependencyError(
      resourceType,
      dependencyName,
      publicId,
    );
  }

  return localId;
}
