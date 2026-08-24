import {
  DEFAULT_QLIK_CLEAN_RECIPE,
  type QlikCleanKeys,
  type QlikCleanOutput,
  type QlikCleanRecipe,
  type QlikRowFilter,
  type QlikRowFilterMode,
  type QlikRowFilterOp,
} from '../src/types/portal.js';
import { AppError } from './errors.js';
import {
  applyQlikClean as applySharedQlikClean,
  presentQlikPayload,
  QlikTransformError,
  shapeQlikPayload,
} from '../src/lib/qlik-transform.js';
import type { QlikTablePayload } from '../src/lib/qlik-payload.js';

const OUTPUTS = new Set<QlikCleanOutput>(['qlik', 'rows', 'as-of-rows']);
const KEYS = new Set<QlikCleanKeys>(['slug', 'title']);
const ROW_FILTER_MODES = new Set<QlikRowFilterMode>(['and', 'or']);
const ROW_FILTER_OPS = new Set<QlikRowFilterOp>(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'empty', 'notEmpty']);
const VALUE_OPS = new Set<QlikRowFilterOp>(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains']);
const MAX_KEEP_COLUMNS = 40;
const MAX_COLUMN_NAME = 80;
const MAX_ROW_FILTERS = 20;
const MAX_FILTER_VALUE = 120;

export { presentQlikPayload, shapeQlikPayload };

export function parseQlikCleanRecipe(value: unknown): QlikCleanRecipe {
  if (value == null || value === '') return copyDefaultRecipe();
  let raw: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return copyDefaultRecipe();
    try { raw = JSON.parse(value) as unknown; }
    catch { throw new AppError(400, 'QLIK_CLEAN_INVALID', 'The Qlik clean recipe is invalid.'); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError(400, 'QLIK_CLEAN_INVALID', 'The Qlik clean recipe is invalid.');
  }
  const input = raw as Record<string, unknown>;
  const output = input.output == null ? DEFAULT_QLIK_CLEAN_RECIPE.output : String(input.output);
  const keys = input.keys == null ? (output === 'qlik' ? 'slug' : 'title') : String(input.keys);
  if (!OUTPUTS.has(output as QlikCleanOutput)) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'Choose how the Qlik JSON should be stored for the report.');
  if (!KEYS.has(keys as QlikCleanKeys)) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'Choose slug keys or original column titles.');
  const keepColumns = Array.isArray(input.keepColumns)
    ? input.keepColumns.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (keepColumns.length > MAX_KEEP_COLUMNS) throw new AppError(400, 'QLIK_CLEAN_INVALID', `Keep at most ${MAX_KEEP_COLUMNS} columns.`);
  if (keepColumns.some((item) => item.length > MAX_COLUMN_NAME)) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'A keep-column name is too long.');
  const rowFilterMode = input.rowFilterMode == null ? DEFAULT_QLIK_CLEAN_RECIPE.rowFilterMode : String(input.rowFilterMode);
  if (!ROW_FILTER_MODES.has(rowFilterMode as QlikRowFilterMode)) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'Choose whether rows must match all conditions or any condition.');
  return {
    output: output as QlikCleanOutput,
    keys: keys as QlikCleanKeys,
    keepColumns,
    dropEmptyRows: input.dropEmptyRows === true,
    rowFilterMode: rowFilterMode as QlikRowFilterMode,
    rowFilters: parseRowFilters(input.rowFilters),
  };
}

export function parseStoredQlikCleanRecipe(value: unknown): QlikCleanRecipe {
  try { return parseQlikCleanRecipe(value); }
  catch { return copyDefaultRecipe(); }
}

export function applyQlikClean(payload: QlikTablePayload, recipe: QlikCleanRecipe): QlikTablePayload {
  try { return applySharedQlikClean(payload, recipe); }
  catch (error) {
    if (error instanceof QlikTransformError) throw new AppError(400, error.code, error.message);
    throw error;
  }
}

function copyDefaultRecipe(): QlikCleanRecipe {
  return { ...DEFAULT_QLIK_CLEAN_RECIPE, keepColumns: [], rowFilters: [] };
}

function parseRowFilters(value: unknown): QlikRowFilter[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'Row conditions must be a list.');
  if (value.length > MAX_ROW_FILTERS) throw new AppError(400, 'QLIK_CLEAN_INVALID', `Keep at most ${MAX_ROW_FILTERS} row conditions.`);
  const filters: QlikRowFilter[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError(400, 'QLIK_CLEAN_INVALID', 'Each row condition needs a column and an operator.');
    }
    const input = item as Record<string, unknown>;
    const column = String(input.column ?? '').trim();
    if (!column) continue;
    if (column.length > MAX_COLUMN_NAME) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'A row-condition column name is too long.');
    const op = String(input.op ?? '');
    if (!ROW_FILTER_OPS.has(op as QlikRowFilterOp)) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'Choose a valid row condition.');
    if (!VALUE_OPS.has(op as QlikRowFilterOp)) {
      filters.push({ column, op: op as QlikRowFilterOp });
      continue;
    }
    const valueText = input.value == null ? '' : String(input.value).trim();
    if (!valueText) throw new AppError(400, 'QLIK_CLEAN_INVALID', `Enter a value for the ${column} condition.`);
    if (valueText.length > MAX_FILTER_VALUE) throw new AppError(400, 'QLIK_CLEAN_INVALID', 'A row-condition value is too long.');
    filters.push({ column, op: op as QlikRowFilterOp, value: valueText });
  }
  return filters;
}
