function getDatePartsInTimeZone(
  timeZone: string,
  value: Date,
  options: Intl.DateTimeFormatOptions,
) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    ...options,
  });

  return formatter.formatToParts(value);
}

export function getLabDateInput(
  timeZone: string,
  value: Date = new Date(),
): string {
  const parts = getDatePartsInTimeZone(timeZone, value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

export function getLabDateToken(
  timeZone: string,
  value: Date = new Date(),
): string {
  return getLabDateInput(timeZone, value).replace(/-/g, '');
}

export function getMonthKey(
  timeZone: string,
  value: Date = new Date(),
): string {
  const parts = getDatePartsInTimeZone(timeZone, value, {
    year: 'numeric',
    month: '2-digit',
  });
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';

  return `${year}-${month}`;
}

export function getLocalDateExpression(timeZone: string, expression: string) {
  return `date(timezone('${timeZone}', ${expression}))`;
}
