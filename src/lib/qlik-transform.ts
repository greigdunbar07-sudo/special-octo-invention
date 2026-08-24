import type { QlikCleanKeys, QlikCleanRecipe, QlikRowFilter } from '../types/portal.js';
import type { ExpandedQlikTablePayload, QlikCell, QlikColumn, QlikTablePayload } from './qlik-payload.js';

export class QlikTransformError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'QlikTransformError';
  }
}

export function expandQlikPayload(payload: QlikTablePayload, options?: { keys?: QlikCleanKeys }): ExpandedQlikTablePayload {
  const keys = options?.keys ?? 'slug';
  const used = new Set<string>();
  const names = payload.columns.map((column) => {
    const base = keys === 'title' ? (column.title.trim() || column.key) : column.key;
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base} ${suffix}`;
      suffix += 1;
    }
    used.add(name);
    return name;
  });
  return {
    asOf: payload.asOf,
    appId: payload.appId,
    objectId: payload.objectId,
    columns: payload.columns,
    rows: payload.rows.map((line) => {
      const row: Record<string, QlikCell> = {};
      names.forEach((name, index) => { row[name] = line[index] ?? null; });
      return row;
    }),
  };
}

export function applyQlikClean(payload: QlikTablePayload, recipe: QlikCleanRecipe): QlikTablePayload {
  let rows = filterRows(payload.columns, payload.rows, recipe);
  const columns = selectColumns(payload.columns, recipe.keepColumns);
  const indexes = columns.map((column) => payload.columns.indexOf(column));
  rows = rows.map((line) => indexes.map((index) => line[index] ?? null));
  if (recipe.dropEmptyRows) rows = rows.filter((line) => line.some((cell) => cell != null && cell !== ''));
  return { ...payload, columns, rows };
}

export function shapeQlikPayload(payload: ExpandedQlikTablePayload, recipe: QlikCleanRecipe): unknown {
  if (recipe.output === 'rows') return payload.rows;
  if (recipe.output === 'as-of-rows') return { asOf: payload.asOf, rows: payload.rows };
  return payload;
}

export function presentQlikPayload(payload: QlikTablePayload, recipe: QlikCleanRecipe): unknown {
  return shapeQlikPayload(expandQlikPayload(payload, { keys: recipe.keys }), recipe);
}

export function sameQlikColumn(column: Pick<QlikColumn, 'key' | 'title'>, wanted: string): boolean {
  const needle = wanted.trim().toLowerCase();
  return column.key.toLowerCase() === needle || column.title.toLowerCase() === needle;
}

function filterRows(columns: QlikColumn[], rows: QlikCell[][], recipe: QlikCleanRecipe): QlikCell[][] {
  if (!recipe.rowFilters.length) return rows;
  const indexes = recipe.rowFilters.map((filter) => {
    const match = columns.find((column) => sameQlikColumn(column, filter.column));
    if (!match) return -1;
    return columns.indexOf(match);
  });
  const missing = recipe.rowFilters.filter((_, index) => indexes[index] < 0).map((filter) => filter.column);
  if (missing.length) {
    throw new QlikTransformError('QLIK_CLEAN_UNKNOWN_COLUMN', `Those Qlik columns were not in the table: ${missing.join(', ')}.`);
  }
  return rows.filter((line) => {
    const matches = recipe.rowFilters.map((filter, index) => cellMatches(line[indexes[index]] ?? null, filter));
    return recipe.rowFilterMode === 'or' ? matches.some(Boolean) : matches.every(Boolean);
  });
}

function cellMatches(cell: QlikCell, filter: QlikRowFilter): boolean {
  if (filter.op === 'empty') return cell == null || cell === '';
  if (filter.op === 'notEmpty') return cell != null && cell !== '';
  if (filter.op === 'gt' || filter.op === 'gte' || filter.op === 'lt' || filter.op === 'lte') {
    const left = toNumber(cell);
    const right = toNumber(filter.value);
    if (left == null || right == null) return false;
    if (filter.op === 'gt') return left > right;
    if (filter.op === 'gte') return left >= right;
    if (filter.op === 'lt') return left < right;
    return left <= right;
  }
  if (filter.op === 'contains') {
    if (cell == null) return false;
    return String(cell).toLowerCase().includes((filter.value ?? '').toLowerCase());
  }
  const leftNum = toNumber(cell);
  const rightNum = toNumber(filter.value);
  if (leftNum != null && rightNum != null) {
    const equal = leftNum === rightNum;
    return filter.op === 'eq' ? equal : !equal;
  }
  const left = cell == null ? '' : String(cell).toLowerCase();
  const right = (filter.value ?? '').toLowerCase();
  const equal = left === right;
  return filter.op === 'eq' ? equal : !equal;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;
  const normalised = trimmed.replace(/[£,\s]/g, '');
  const signed = normalised.startsWith('(') && normalised.endsWith(')')
    ? `-${normalised.slice(1, -1)}`
    : normalised;
  const parsed = Number(signed);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectColumns(columns: QlikColumn[], keepColumns: string[]): QlikColumn[] {
  if (!keepColumns.length) return columns;
  const selected: QlikColumn[] = [];
  const missing: string[] = [];
  for (const wanted of keepColumns) {
    const match = columns.find((column) => sameQlikColumn(column, wanted));
    if (!match) missing.push(wanted);
    else if (!selected.includes(match)) selected.push(match);
  }
  if (missing.length) {
    throw new QlikTransformError('QLIK_CLEAN_UNKNOWN_COLUMN', `Those Qlik columns were not in the table: ${missing.join(', ')}.`);
  }
  return selected;
}
