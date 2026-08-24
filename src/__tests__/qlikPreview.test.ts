// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../server/config.js';
import { QlikPullService } from '../../server/qlik.js';
import { QlikAppSessionCache } from '../../server/qlik-session.js';
import type { PortalIdentity } from '../../src/types/portal.js';

const appId = '1df4cf94-0a3b-4246-848e-40200247bfba';
const admin: PortalIdentity = {
  id: 'admin-1', tenantId: 'tenant-1', entraObjectId: 'entra-1',
  email: 'admin@example.com', displayName: 'Admin', role: 'admin', status: 'active',
};
const config: AppConfig = {
  port: 8080, tenantId: 'tenant-1', bootstrapAdminEmail: 'admin@example.com',
  sqlServer: '', sqlDatabase: '', storageAccount: '', storageContainer: 'portal-data',
  staticRoot: 'dist', artifactRoot: 'artifacts', bundleRoot: 'tmp/portal-data', production: false, usageTelemetryMode: 'off', usageInsightsEnabled: false, usageEventRetentionDays: 180,
  qlikTenantUrl: 'https://example.eu.qlikcloud.com', qlikApiKey: 'secret',
};

describe('Qlik preview', () => {
  it('returns a sample grid and does not persist a dataset', async () => {
    const session = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'GetObject') return { qReturn: { qHandle: 2 } };
        if (method === 'GetLayout') {
          return { qHyperCube: { qMode: 'S', qSize: { qcx: 1, qcy: 400 }, qDimensionInfo: [{ qFallbackTitle: 'Name' }], qMeasureInfo: [] } };
        }
        if (method === 'GetHyperCubeData') return { qDataPages: [{ qMatrix: [[{ qText: 'A' }], [{ qText: 'B' }]] }] };
        throw new Error(method);
      }),
      close: vi.fn(),
    };
    const upload = vi.fn();
    const cache = new QlikAppSessionCache(async () => ({ session, appHandle: 1 }), { idleMs: 60_000 });
    const qlik = new QlikPullService(config, { requireAdmin() { return admin; } } as never, { upload } as never, cache);

    const sample = await qlik.preview(admin, { appId, objectId: 'WuPA' });
    cache.closeAll();

    expect(sample).toEqual({
      appId, objectId: 'WuPA',
      columns: [{ key: 'name', title: 'Name', role: 'dimension' }],
      rows: [['A'], ['B']],
      sourceRowCount: 400,
      truncated: true,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('reuses a cached table catalog without opening the app again', async () => {
    const session = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'GetAllInfos') return { qInfos: [] };
        throw new Error(method);
      }),
      close: vi.fn(),
    };
    const cache = new QlikAppSessionCache(async () => ({ session, appHandle: 1 }), { idleMs: 60_000 });
    const qlik = new QlikPullService(config, { requireAdmin() { return admin; } } as never, { upload: vi.fn() } as never, cache);

    await expect(qlik.listTables(admin, appId)).resolves.toEqual([]);
    await expect(qlik.listTables(admin, appId)).resolves.toEqual([]);
    cache.closeAll();
    expect(session.rpc.mock.calls.filter((call) => call[0] === 'GetAllInfos')).toHaveLength(1);
  });
});
