const SQL_COMPACT_NORMALIZE_FROM = 'áàäâéèëêíìïîóòöôúùüûñ';
const SQL_COMPACT_NORMALIZE_TO = 'aaaaeeeeiiiioooouuuun';

export function normalizeCompactSearchText(value?: string | null) {
  if (!value) {
    return '';
  }

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
    .trim();
}

export function buildCompactSearchSqlExpression(expression: string) {
  return `regexp_replace(translate(lower(coalesce(${expression}, '')), '${SQL_COMPACT_NORMALIZE_FROM}', '${SQL_COMPACT_NORMALIZE_TO}'), '[^a-z0-9]+', '', 'g')`;
}
