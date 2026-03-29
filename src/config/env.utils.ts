const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return defaultValue;
  }

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return defaultValue;
}

export function parseNumberEnv(
  value: string | undefined,
  defaultValue: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function parseOptionalStringEnv(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function parseStringListEnv(
  value: string | undefined,
  defaultValue: string[] = [],
) {
  const parsed =
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? [];

  return parsed.length > 0 ? parsed : defaultValue;
}
