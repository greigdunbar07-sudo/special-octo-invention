// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../server/errors.js';
import {
  columnKey,
  expandQlikPayload,
  extractQlikTable,
  flattenHyperCube,
  hyperCubePageHeight,
  listQlikTables,
  nextDueAt,
  splitQlikRowChunks,
  validateQlikObjectRef,
  validateRefreshTime,
} from '../../server/qlik-extract.js';

describe('Qlik extract helpers', () => {
  it('pages hypercubes so each request stays under 10,000 cells', () => {
    expect(hyperCubePageHeight(2)).toBe(5000);
    expect(hyperCubePageHeight(20)).toBe(500);
  });

  it('keeps column keys unique', () => {
    const used = new Set<string>();
    expect(columnKey('Supplier Name', used)).toBe('supplier-name');
    expect(columnKey('Supplier Name', used)).toBe('supplier-name-2');
  });

  it('computes the next UTC due time', () => {
    const from = new Date('2026-08-21T07:30:00.000Z');
    expect(nextDueAt(from, 8, 0).toISOString()).toBe('2026-08-21T08:00:00.000Z');
    expect(nextDueAt(from, 7, 0).toISOString()).toBe('2026-08-22T07:00:00.000Z');
  });

  it('rejects invalid Qlik identifiers and refresh times', () => {
    expect(() => validateQlikObjectRef({ appId: 'not-a-guid', objectId: 'abc' })).toThrow(AppError);
    expect(() => validateRefreshTime(24, 0)).toThrow(AppError);
    expect(validateQlikObjectRef({ appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'e5c80ad6-3d3a-499c-afc7-d60eb9c4f27b' }).objectId).toBe('e5c80ad6-3d3a-499c-afc7-d60eb9c4f27b');
  });

  it('flattens a straight table hypercube into JSON rows', () => {
    const payload = flattenHyperCube({
      qHyperCube: {
        qMode: 'S',
        qSize: { qcx: 2, qcy: 2 },
        qDimensionInfo: [{ qFallbackTitle: 'Supplier Name' }],
        qMeasureInfo: [{ qFallbackTitle: 'Sales' }],
      },
    }, [{
      qMatrix: [
        [{ qText: 'CROWN PET FOODS LIMITED' }, { qText: '£143,943.21', qNum: 143943.21 }],
        [{ qText: 'SUPREME' }, { qText: '£3.15', qNum: 3.15 }],
      ],
    }], { appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'e5c80ad6-3d3a-499c-afc7-d60eb9c4f27b', asOf: '2026-08-21T21:00:00.000Z' });

    expect(payload.rows).toEqual([
      ['CROWN PET FOODS LIMITED', 143943.21],
      ['SUPREME', 3.15],
    ]);
    expect(payload.columns.map((column) => column.role)).toEqual(['dimension', 'measure']);
  });

  it('uses the numeric dual value for dimension cells that display a pound amount', () => {
    const payload = flattenHyperCube({
      qHyperCube: {
        qMode: 'S',
        qDimensionInfo: [{ qFallbackTitle: 'Product List Price' }],
        qMeasureInfo: [],
      },
    }, [{
      qMatrix: [[{ qText: '£12.50', qNum: 12.5 }], [{ qText: '£0.00', qNum: 0 }]],
    }], { appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a', objectId: 'NEZnpqm', asOf: '2026-08-22T00:00:00.000Z' });
    expect(payload.rows).toEqual([[12.5], [0]]);
  });

  it('pages engine data through an injected session', async () => {
    const session = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'OpenDoc') return { qReturn: { qHandle: 1 } };
        if (method === 'GetObject') return { qReturn: { qHandle: 2 } };
        if (method === 'GetLayout') {
          return {
            qHyperCube: {
              qMode: 'S',
              qSize: { qcx: 1, qcy: 2 },
              qDimensionInfo: [{ qFallbackTitle: 'Name' }],
              qMeasureInfo: [],
            },
          };
        }
        if (method === 'GetHyperCubeData') return { qDataPages: [{ qMatrix: [[{ qText: 'A' }], [{ qText: 'B' }]] }] };
        throw new Error(method);
      }),
      close: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200, headers: { 'qlik-csrf-token': 'csrf' } }));

    const payload = await extractQlikTable({
      tenantUrl: 'https://example.eu.qlikcloud.com',
      apiKey: 'secret',
      appId: '1df4cf94-0a3b-4246-848e-40200247bfba',
      objectId: 'table-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openSession: async () => session,
    });

    expect(payload.rows).toEqual([['A'], ['B']]);
    expect(session.close).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/api/v1/csrf-token'), expect.objectContaining({
      headers: { Authorization: 'Bearer secret' },
    }));
  });

  it('opens the engine session when Qlik refuses a CSRF token for the API key', async () => {
    const session = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'OpenDoc') return { qReturn: { qHandle: 1 } };
        if (method === 'GetObject') return { qReturn: { qHandle: 2 } };
        if (method === 'GetLayout') {
          return { qHyperCube: { qMode: 'S', qSize: { qcx: 1, qcy: 1 }, qDimensionInfo: [{ qFallbackTitle: 'Name' }], qMeasureInfo: [] } };
        }
        if (method === 'GetHyperCubeData') return { qDataPages: [{ qMatrix: [[{ qText: 'A' }]] }] };
        throw new Error(method);
      }),
      close: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      errors: [{ title: 'CSRF token not supported for given authentication type.' }],
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    const openSession = vi.fn(async (url: string) => {
      expect(url).toBe('wss://example.eu.qlikcloud.com/app/1df4cf94-0a3b-4246-848e-40200247bfba');
      return session;
    });

    await extractQlikTable({
      tenantUrl: 'https://example.eu.qlikcloud.com',
      apiKey: 'secret',
      appId: '1df4cf94-0a3b-4246-848e-40200247bfba',
      objectId: 'WuPA',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openSession,
    });
    expect(openSession).toHaveBeenCalledOnce();
  });

  it('stops paging when a preview row cap is set', async () => {
    const session = {
      rpc: vi.fn(async (method: string, _handle: number, params?: unknown[]) => {
        if (method === 'OpenDoc') return { qReturn: { qHandle: 1 } };
        if (method === 'GetObject') return { qReturn: { qHandle: 2 } };
        if (method === 'GetLayout') {
          return { qHyperCube: { qMode: 'S', qSize: { qcx: 1, qcy: 500 }, qDimensionInfo: [{ qFallbackTitle: 'Name' }], qMeasureInfo: [] } };
        }
        if (method === 'GetHyperCubeData') {
          const page = (params?.[1] as Array<{ qHeight?: number }>)[0];
          expect(page.qHeight).toBe(2);
          return { qDataPages: [{ qMatrix: [[{ qText: 'A' }], [{ qText: 'B' }]] }] };
        }
        throw new Error(method);
      }),
      close: vi.fn(),
    };
    const payload = await extractQlikTable({
      tenantUrl: 'https://example.eu.qlikcloud.com',
      apiKey: 'secret',
      appId: '1df4cf94-0a3b-4246-848e-40200247bfba',
      objectId: 'table-1',
      maxRows: 2,
      fetchImpl: vi.fn(async () => new Response(null, { status: 400 })) as unknown as typeof fetch,
      openSession: async () => session,
    });
    expect(payload.rows).toEqual([['A'], ['B']]);
    expect(session.rpc.mock.calls.filter((call) => call[0] === 'GetHyperCubeData')).toHaveLength(1);
  });

  it('lists straight tables and skips pivot hypercubes', async () => {
    const session = {
      rpc: vi.fn(async (method: string, handle: number, params?: unknown[]) => {
        if (method === 'GetAllInfos') return { qInfos: [{ qId: 'sheet1', qType: 'sheet' }, { qId: 'WuPA', qType: 'table' }, { qId: 'pivot1', qType: 'pivot-table' }] };
        if (method === 'GetObject' && params?.[0] === 'sheet1') return { qReturn: { qHandle: 10 } };
        if (method === 'GetObject' && params?.[0] === 'WuPA') return { qReturn: { qHandle: 11 } };
        if (method === 'GetObject' && params?.[0] === 'pivot1') return { qReturn: { qHandle: 12 } };
        if (method === 'GetProperties' && handle === 10) return { qProp: { title: 'Commercial' } };
        if (method === 'GetChildInfos') return { qInfos: [{ qId: 'WuPA', qType: 'table' }, { qId: 'pivot1', qType: 'pivot-table' }] };
        if (method === 'GetProperties' && handle === 11) {
          return { title: 'Supplier sales', qHyperCubeDef: { qMode: 'S', qDimensions: [{ qDef: { qLabel: 'Supplier Name' } }], qMeasures: [{ qDef: { qLabel: 'Sales' } }] } };
        }
        if (method === 'GetProperties' && handle === 12) {
          return { title: 'Pivot', qHyperCubeDef: { qMode: 'P', qDimensions: [{ qDef: { qLabel: 'Name' } }], qMeasures: [{ qDef: { qLabel: 'Sales' } }] } };
        }
        throw new Error(`${method}:${handle}:${String(params?.[0])}`);
      }),
      close: vi.fn(),
    };
    const tables = await listQlikTables(session, 1);
    expect(tables).toEqual([{
      objectId: 'WuPA', title: 'Supplier sales', sheetTitle: 'Commercial', qType: 'table',
      columns: ['Supplier Name', 'Sales'], rowCount: 0,
    }]);
  });

  it('maps tables onto sheets from the sheet cell list', async () => {
    const session = {
      rpc: vi.fn(async (method: string, handle: number, params?: unknown[]) => {
        if (method === 'GetAllInfos') return { qInfos: [{ qId: 'sheet1', qType: 'sheet' }, { qId: 'WuPA', qType: 'sn-table' }] };
        if (method === 'GetObject' && params?.[0] === 'sheet1') return { qReturn: { qHandle: 10 } };
        if (method === 'GetObject' && params?.[0] === 'WuPA') return { qReturn: { qHandle: 11 } };
        if (method === 'GetProperties' && handle === 10) return { title: 'Overview', cells: [{ name: 'WuPA', type: 'sn-table' }] };
        if (method === 'GetChildInfos') return { qInfos: [] };
        if (method === 'GetProperties' && handle === 11) {
          return { title: 'Damages by SKU', qHyperCubeDef: { qMode: 0, qDimensions: [{ qDef: { qLabel: 'Product' } }], qMeasures: [] } };
        }
        throw new Error(`${method}:${handle}:${String(params?.[0])}`);
      }),
      close: vi.fn(),
    };
    const tables = await listQlikTables(session, 1);
    expect(tables).toEqual([{
      objectId: 'WuPA', title: 'Damages by SKU', sheetTitle: 'Overview', qType: 'sn-table',
      columns: ['Product'], rowCount: 0,
    }]);
  });

  it('does not open charts that are not table candidates', async () => {
    const session = {
      rpc: vi.fn(async (method: string, handle: number, params?: unknown[]) => {
        if (method === 'GetAllInfos') return { qInfos: [{ qId: 'sheet1', qType: 'sheet' }, { qId: 'WuPA', qType: 'table' }, { qId: 'bar1', qType: 'barchart' }] };
        if (method === 'GetObject' && params?.[0] === 'sheet1') return { qReturn: { qHandle: 10 } };
        if (method === 'GetObject' && params?.[0] === 'WuPA') return { qReturn: { qHandle: 11 } };
        if (method === 'GetProperties' && handle === 10) return { title: 'Commercial' };
        if (method === 'GetChildInfos') return { qInfos: [{ qId: 'WuPA', qType: 'table' }, { qId: 'bar1', qType: 'barchart' }] };
        if (method === 'GetProperties' && handle === 11) {
          return { title: 'Supplier sales', qHyperCubeDef: { qMode: 'S', qDimensions: [{ qDef: { qLabel: 'Name' } }], qMeasures: [] } };
        }
        throw new Error(`${method}:${handle}:${String(params?.[0])}`);
      }),
      close: vi.fn(),
    };
    await listQlikTables(session, 1);
    expect(session.rpc.mock.calls.some((call) => call[0] === 'GetObject' && call[2]?.[0] === 'bar1')).toBe(false);
    expect(session.rpc.mock.calls.some((call) => call[0] === 'GetLayout')).toBe(false);
  });

  it('skips a table whose properties never arrive instead of hanging', async () => {
    const session = {
      rpc: vi.fn(async (method: string, handle: number, params?: unknown[]) => {
        if (method === 'GetAllInfos') return { qInfos: [{ qId: 'WuPA', qType: 'table' }, { qId: 'stuck', qType: 'table' }] };
        if (method === 'GetObject' && params?.[0] === 'WuPA') return { qReturn: { qHandle: 11 } };
        if (method === 'GetObject' && params?.[0] === 'stuck') return { qReturn: { qHandle: 12 } };
        if (method === 'GetProperties' && handle === 11) {
          return { title: 'Supplier sales', qHyperCubeDef: { qDimensions: [{ qDef: { qLabel: 'Name' } }], qMeasures: [] } };
        }
        if (method === 'GetProperties' && handle === 12) return new Promise(() => undefined);
        throw new Error(`${method}:${handle}:${String(params?.[0])}`);
      }),
      close: vi.fn(),
    };
    const tables = await listQlikTables(session, 1, { objectTimeoutMs: 20 });
    expect(tables.map((item) => item.objectId)).toEqual(['WuPA']);
  });

  it('expands compact Qlik rows and splits them into dataset-sized chunks', () => {
    const compact = flattenHyperCube({
      qHyperCube: {
        qMode: 'S',
        qSize: { qcx: 2, qcy: 2 },
        qDimensionInfo: [{ qFallbackTitle: 'Name' }],
        qMeasureInfo: [{ qFallbackTitle: 'Sales' }],
      },
    }, [{ qMatrix: [[{ qText: 'A' }, { qNum: 1 }], [{ qText: 'B' }, { qNum: 2 }]] }], {
      appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'WuPA', asOf: '2026-08-21T22:00:00.000Z',
    });
    expect(expandQlikPayload(compact).rows).toEqual([{ name: 'A', sales: 1 }, { name: 'B', sales: 2 }]);
    const chunks = splitQlikRowChunks([['one'], ['two'], ['three']], 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual([['one'], ['two'], ['three']]);
  });
});
