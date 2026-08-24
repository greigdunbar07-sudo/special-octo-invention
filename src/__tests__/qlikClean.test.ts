// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { AppError } from '../../server/errors.js';
import { applyQlikClean, parseQlikCleanRecipe, presentQlikPayload } from '../../server/qlik-clean.js';
import { flattenHyperCube } from '../../server/qlik-extract.js';

const extracted = flattenHyperCube({
  qHyperCube: {
    qMode: 'S',
    qDimensionInfo: [{ qFallbackTitle: 'Product' }, { qFallbackTitle: 'Unused' }],
    qMeasureInfo: [{ qFallbackTitle: 'List Price' }, { qFallbackTitle: 'Cost Price' }],
  },
}, [{
  qMatrix: [
    [{ qText: 'Apoquel' }, { qText: 'extra' }, { qText: '12.50', qNum: 12.5 }, { qText: '8.00', qNum: 8 }],
    [{ qText: '' }, { qText: '' }, { qIsEmpty: true }, { qIsEmpty: true }],
  ],
}], { appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'WuPA', asOf: '2026-08-21T22:00:00.000Z' });

const catalog = flattenHyperCube({
  qHyperCube: {
    qMode: 'S',
    qDimensionInfo: [{ qFallbackTitle: 'Product' }, { qFallbackTitle: 'Unused' }],
    qMeasureInfo: [{ qFallbackTitle: 'List Price' }, { qFallbackTitle: 'Cost Price' }],
  },
}, [{
  qMatrix: [
    [{ qText: 'Apoquel' }, { qText: 'extra' }, { qText: '12.50', qNum: 12.5 }, { qText: '8.00', qNum: 8 }],
    [{ qText: '' }, { qText: '' }, { qIsEmpty: true }, { qIsEmpty: true }],
    [{ qText: 'Rimadyl' }, { qText: 'extra' }, { qText: '40.00', qNum: 40 }, { qText: '20.00', qNum: 20 }],
    [{ qText: 'Simparica' }, { qText: 'other' }, { qText: '5.00', qNum: 5 }, { qText: '2.00', qNum: 2 }],
  ],
}], { appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'WuPA', asOf: '2026-08-21T22:00:00.000Z' });

describe('Qlik post-extract cleaning', () => {
  it('keeps named columns, drops empty rows, and emits a row array with original titles', () => {
    const recipe = parseQlikCleanRecipe({
      output: 'rows',
      keys: 'title',
      keepColumns: ['Product', 'List Price', 'Cost Price'],
      dropEmptyRows: true,
    });
    const cleaned = applyQlikClean(extracted, recipe);
    expect(cleaned.columns.map((column) => column.title)).toEqual(['Product', 'List Price', 'Cost Price']);
    expect(cleaned.rows).toEqual([['Apoquel', 12.5, 8]]);
    expect(presentQlikPayload(cleaned, recipe)).toEqual([{ Product: 'Apoquel', 'List Price': 12.5, 'Cost Price': 8 }]);
  });

  it('rejects keep-columns that were not in the Qlik table', () => {
    expect(() => applyQlikClean(extracted, parseQlikCleanRecipe({ keepColumns: ['SKU'] }))).toThrow(AppError);
  });

  it('defaults missing row-filter fields so older saved recipes still parse', () => {
    expect(parseQlikCleanRecipe({ output: 'qlik', keys: 'slug', keepColumns: [], dropEmptyRows: false })).toEqual({
      output: 'qlik', keys: 'slug', keepColumns: [], dropEmptyRows: false, rowFilterMode: 'and', rowFilters: [],
    });
  });

  it('keeps measure rows greater than a numeric threshold', () => {
    const recipe = parseQlikCleanRecipe({
      rowFilters: [{ column: 'List Price', op: 'gt', value: '10' }],
    });
    expect(applyQlikClean(catalog, recipe).rows.map((row) => row[0])).toEqual(['Apoquel', 'Rimadyl']);
  });

  it('keeps a row only when every AND condition matches', () => {
    const recipe = parseQlikCleanRecipe({
      rowFilterMode: 'and',
      rowFilters: [
        { column: 'Product', op: 'eq', value: 'Apoquel' },
        { column: 'List Price', op: 'gt', value: '10' },
      ],
    });
    expect(applyQlikClean(catalog, recipe).rows).toEqual([['Apoquel', 'extra', 12.5, 8]]);
  });

  it('keeps a row when any OR condition matches', () => {
    const recipe = parseQlikCleanRecipe({
      rowFilterMode: 'or',
      rowFilters: [
        { column: 'Product', op: 'eq', value: 'Apoquel' },
        { column: 'List Price', op: 'gt', value: '30' },
      ],
    });
    expect(applyQlikClean(catalog, recipe).rows.map((row) => row[0])).toEqual(['Apoquel', 'Rimadyl']);
  });

  it('rejects row-filter columns that were not in the Qlik table', () => {
    expect(() => applyQlikClean(catalog, parseQlikCleanRecipe({ rowFilters: [{ column: 'SKU', op: 'eq', value: '1' }] }))).toThrow(AppError);
  });

  it('keeps empty cells with the empty operator', () => {
    const recipe = parseQlikCleanRecipe({ rowFilters: [{ column: 'Product', op: 'empty' }] });
    expect(applyQlikClean(extracted, recipe).rows).toEqual([[null, null, null, null]]);
  });

  it('compares numbers when both sides are numeric and text otherwise', () => {
    const numeric = parseQlikCleanRecipe({ rowFilters: [{ column: 'List Price', op: 'eq', value: '12.5' }] });
    expect(applyQlikClean(catalog, numeric).rows.map((row) => row[0])).toEqual(['Apoquel']);
    const text = parseQlikCleanRecipe({ rowFilters: [{ column: 'Product', op: 'eq', value: 'apoquel' }] });
    expect(applyQlikClean(catalog, text).rows.map((row) => row[0])).toEqual(['Apoquel']);
    const notNumeric = parseQlikCleanRecipe({ rowFilters: [{ column: 'Product', op: 'gt', value: '10' }] });
    expect(applyQlikClean(catalog, notNumeric).rows).toEqual([]);
  });

  it('treats pound-formatted list prices as numbers for greater-than filters', () => {
    const priced = flattenHyperCube({
      qHyperCube: {
        qMode: 'S',
        qDimensionInfo: [{ qFallbackTitle: 'Product' }, { qFallbackTitle: 'Product List Price' }],
        qMeasureInfo: [],
      },
    }, [{
      qMatrix: [
        [{ qText: 'Apoquel' }, { qText: '£12.50' }],
        [{ qText: 'Zero' }, { qText: '£0.00' }],
        [{ qText: 'Blank' }, { qText: '' }],
      ],
    }], { appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a', objectId: 'NEZnpqm', asOf: '2026-08-22T00:00:00.000Z' });
    const recipe = parseQlikCleanRecipe({
      rowFilters: [{ column: 'Product List Price', op: 'gt', value: '0' }],
    });
    expect(applyQlikClean(priced, recipe).rows).toEqual([['Apoquel', '£12.50']]);
  });

  it('filters on a column that is later dropped from the stored table', () => {
    const recipe = parseQlikCleanRecipe({
      keepColumns: ['Product', 'List Price'],
      rowFilters: [{ column: 'Unused', op: 'eq', value: 'extra' }],
    });
    const cleaned = applyQlikClean(catalog, recipe);
    expect(cleaned.columns.map((column) => column.title)).toEqual(['Product', 'List Price']);
    expect(cleaned.rows).toEqual([['Apoquel', 12.5], ['Rimadyl', 40]]);
  });

  it('applies a preview sample in memory without changing the extracted payload', () => {
    const recipe = parseQlikCleanRecipe({ keepColumns: ['Product'], dropEmptyRows: true });
    const preview = applyQlikClean(catalog, recipe);
    expect(preview.rows).toEqual([['Apoquel'], ['Rimadyl'], ['Simparica']]);
    expect(catalog.columns.map((column) => column.title)).toEqual(['Product', 'Unused', 'List Price', 'Cost Price']);
    expect(catalog.rows).toHaveLength(4);
  });
});
