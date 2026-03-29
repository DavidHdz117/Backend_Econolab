export const SYNC_OUTBOX_SKIP_FLAG = '__skipSyncOutbox__';
const SYNC_METADATA_PRESERVE_REMOTE_FLAG = '__preserveRemoteSyncMetadata__';

export function markSyncEntityForRemoteApply<T extends object>(entity: T): T {
  Object.defineProperty(entity, SYNC_METADATA_PRESERVE_REMOTE_FLAG, {
    value: true,
    configurable: true,
    enumerable: false,
    writable: true,
  });

  return entity;
}

export function shouldPreserveRemoteSyncMetadata(entity: unknown) {
  if (!entity || typeof entity !== 'object') {
    return false;
  }

  return Boolean(
    (entity as Record<string, unknown>)[SYNC_METADATA_PRESERVE_REMOTE_FLAG],
  );
}
