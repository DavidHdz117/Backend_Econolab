export function buildPersonName(
  firstName?: string | null,
  lastName?: string | null,
  middleName?: string | null,
) {
  return [firstName, lastName, middleName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatAgeLabel(birthDate?: string, fallback = 'N/D'): string {
  if (!birthDate) {
    return fallback;
  }

  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) {
    return fallback;
  }

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();

  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getDate() < birth.getDate())
  ) {
    age -= 1;
  }

  return `${age} años`;
}
