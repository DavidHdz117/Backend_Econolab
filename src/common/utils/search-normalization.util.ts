import type { SupportedDatabaseType } from '../../config/database.config';

const SQL_COMPACT_NORMALIZE_FROM =
  '\u00E1\u00E0\u00E4\u00E2\u00E9\u00E8\u00EB\u00EA\u00ED\u00EC\u00EF\u00EE\u00F3\u00F2\u00F6\u00F4\u00FA\u00F9\u00FC\u00FB\u00F1';
const SQL_COMPACT_NORMALIZE_TO = 'aaaaeeeeiiiioooouuuun';

const SQLITE_COMPACT_STRIP_CHARACTERS = [
  ' ',
  '-',
  '_',
  '/',
  '.',
  ',',
];

const SQLITE_DIGITS_ONLY_STRIP_CHARACTERS = [
  ' ',
  '-',
  '(',
  ')',
  '+',
  '.',
  '/',
  '[',
  ']',
  '{',
  '}',
  ':',
];

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function buildSqliteReplaceChain(
  expression: string,
  replacements: Array<[string, string]>,
) {
  return replacements.reduce(
    (current, [from, to]) =>
      `replace(${current}, '${escapeSqlLiteral(from)}', '${escapeSqlLiteral(to)}')`,
    expression,
  );
}

function stripSqliteCharacters(expression: string, characters: string[]) {
  return characters.reduce(
    (current, character) =>
      `replace(${current}, '${escapeSqlLiteral(character)}', '')`,
    expression,
  );
}

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

export function buildCompactSearchSqlExpression(
  expression: string,
  databaseType: SupportedDatabaseType = 'postgres',
) {
  if (databaseType === 'sqlite') {
    return stripSqliteCharacters(
      `lower(ifnull(${expression}, ''))`,
      SQLITE_COMPACT_STRIP_CHARACTERS,
    );
  }

  return `regexp_replace(translate(lower(coalesce(${expression}, '')), '${SQL_COMPACT_NORMALIZE_FROM}', '${SQL_COMPACT_NORMALIZE_TO}'), '[^a-z0-9]+', '', 'g')`;
}

export function buildDigitsOnlySqlExpression(
  expression: string,
  databaseType: SupportedDatabaseType = 'postgres',
) {
  if (databaseType === 'sqlite') {
    return stripSqliteCharacters(
      `ifnull(${expression}, '')`,
      SQLITE_DIGITS_ONLY_STRIP_CHARACTERS,
    );
  }

  return `regexp_replace(coalesce(${expression}, ''), '[^0-9]+', '', 'g')`;
}

export function buildLowerTrimSqlExpression(
  expression: string,
  databaseType: SupportedDatabaseType = 'postgres',
) {
  if (databaseType === 'sqlite') {
    return `lower(trim(ifnull(${expression}, '')))`;
  }

  return `lower(trim(coalesce(${expression}, '')))`;
}
