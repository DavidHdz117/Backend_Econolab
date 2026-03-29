import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolvePortablePath(input?: string | null) {
  const normalized = input?.trim();

  if (!normalized) {
    return null;
  }

  return path.isAbsolute(normalized)
    ? path.normalize(normalized)
    : path.resolve(process.cwd(), normalized);
}

export function findFirstExistingPath(
  candidates: Array<string | null | undefined>,
) {
  for (const candidate of candidates) {
    const resolved = resolvePortablePath(candidate);

    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}
