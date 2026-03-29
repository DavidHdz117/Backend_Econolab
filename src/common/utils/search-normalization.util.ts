import type { SupportedDatabaseType } from '../../config/database.config';

const SQL_COMPACT_NORMALIZE_FROM =
  '\u00E1\u00E0\u00E4\u00E2\u00E9\u00E8\u00EB\u00EA\u00ED\u00EC\u00EF\u00EE\u00F3\u00F2\u00F6\u00F4\u00FA\u00F9\u00FC\u00FB\u00F1';
const SQL_COMPACT_NORMALIZE_TO = 'aaaaeeeeiiiioooouuuun';

const SQLITE_ACCENT_REPLACEMENTS: Array<[string, string]> = [
  ['\u00E1', 'a'],
  ['\u00E0', 'a'],
  ['\u00E4', 'a'],
  ['\u00E2', 'a'],
  ['\u00C1', 'a'],
  ['\u00C0', 'a'],
  ['\u00C4', 'a'],
  ['\u00C2', 'a'],
  ['\u00E9', 'e'],
  ['\u00E8', 'e'],
  ['\u00EB', 'e'],
  ['\u00EA', 'e'],
  ['\u00C9', 'e'],
  ['\u00C8', 'e'],
  ['\u00CB', 'e'],
  ['\u00CA', 'e'],
  ['\u00ED', 'i'],
  ['\u00EC', 'i'],
  ['\u00EF', 'i'],
  ['\u00EE', 'i'],
  ['\u00CD', 'i'],
  ['\u00CC', 'i'],
  ['\u00CF', 'i'],
  ['\u00CE', 'i'],
  ['\u00F3', 'o'],
  ['\u00F2', 'o'],
  ['\u00F6', 'o'],
  ['\u00F4', 'o'],
  ['\u00D3', 'o'],
  ['\u00D2', 'o'],
  ['\u00D6', 'o'],
  ['\u00D4', 'o'],
  ['\u00FA', 'u'],
  ['\u00F9', 'u'],
  ['\u00FC', 'u'],
  ['\u00FB', 'u'],
  ['\u00DA', 'u'],
  ['\u00D9', 'u'],
  ['\u00DC', 'u'],
  ['\u00DB', 'u'],
  ['\u00F1', 'n'],
  ['\u00D1', 'n'],
];

const SQLITE_COMPACT_STRIP_CHARACTERS = [
  ' ',
  '-',
  '_',
  '/',
  '.',
  ',',
  ':',
  ';',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '+',
  '#',
  '"',
  "'",
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
    const accentFolded = buildSqliteReplaceChain(
      `ifnull(${expression}, '')`,
      SQLITE_ACCENT_REPLACEMENTS,
    );

    return stripSqliteCharacters(
      `lower(${accentFolded})`,
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
