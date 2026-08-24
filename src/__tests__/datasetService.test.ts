// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIVE_SCHEMA } from '../../scripts/artifact-package.mjs';
import type { ArtifactRegistry } from '../../server/artifacts.js';
import type { AppConfig } from '../../server/config.js';
import { DatasetService } from '../../server/datasets.js';
import { QLIK_CHUNK_FORMAT } from '../../server/qlik-extract.js';
import type { PortalRepository } from '../../server/repository.js';
import { PortalStorage } from '../../server/storage.js';
import type { PortalIdentity } from '../types/portal.js';

const admin: PortalIdentity = {
  id: 'admin-a', tenantId: 'tenant-a', entraObjectId: 'entra-a', email: 'admin@example.com', displayName: 'Admin A', role: 'admin', status: 'active',
};

describe('DatasetService Qlik extracts', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function createService() {
    const bundleRoot = mkdtempSync(join(tmpdir(), 'dataset-qlik-'));
    roots.push(bundleRoot);
    const config: AppConfig = {
      port: 8080, tenantId: admin.tenantId, bootstrapAdminEmail: admin.email, sqlServer: '', sqlDatabase: '', storageAccount: '', storageContainer: 'portal-data',
      staticRoot: resolve('dist'), artifactRoot: resolve('artifacts'), bundleRoot, production: false, usageTelemetryMode: 'off', usageInsightsEnabled: false, usageEventRetentionDays: 180,
    };
    let stored: { checksum: string; storageLocation: string } | undefined;
    const registry = {
      tryByDatabaseId: vi.fn(() => ({
        databaseId: 'artifact-1',
        source: 'bundled',
        manifest: {
          schemaVersion: 1, id: 'declining', title: 'Declining', kind: 'report', version: '1.0.0',
          entry: 'index.html', owner: 'Ops', capabilities: [],
          datasets: [{ key: 'data', schemaVersion: 1, maxBytes: 10 * 1024 * 1024 }],
        },
        schemas: new Map([['data', PERMISSIVE_SCHEMA]]),
      })),
    } as unknown as ArtifactRegistry;
    const repository = {
      requireAdmin: vi.fn(),
      canReadArtifact: vi.fn(async () => undefined),
      registerDataset: vi.fn(async (_actor, values: { checksum: string; storageLocation: string }) => { stored = values; }),
      activeDataset: vi.fn(async () => stored),
      getQlikBinding: vi.fn(async () => null),
    } as unknown as PortalRepository;
    const storage = new PortalStorage(config);
    return { stored: () => stored, storage, repository, service: new DatasetService(registry, repository, storage) };
  }

  it('expands compact Qlik rows when the report reads the dataset', async () => {
    const { service } = createService();
    await service.upload(admin, 'artifact-1', 'data', {
      asOf: '2026-08-21T22:00:00.000Z',
      appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a',
      objectId: 'WuPA',
      columns: [{ key: 'name', title: 'Name', role: 'dimension' }],
      rows: [['A'], ['B']],
    });
    const envelope = await service.download(admin, 'artifact-1', 'data');
    expect(envelope.payload).toMatchObject({ rows: [{ name: 'A' }, { name: 'B' }] });
  });

  it('stores an oversized Qlik extract as chunks and reassembles named rows', async () => {
    const { stored, storage, service } = createService();
    const rows = Array.from({ length: 4_000 }, (_, index) => [`row-${index}-${'x'.repeat(4_000)}`]);
    await service.upload(admin, 'artifact-1', 'data', {
      asOf: '2026-08-21T22:00:00.000Z',
      appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a',
      objectId: 'WuPA',
      columns: [{ key: 'name', title: 'Name', role: 'dimension' }],
      rows,
    });
    const envelope = JSON.parse((await storage.get(stored()!.storageLocation)).toString('utf8')) as { payload: { format?: string; parts?: string[] } };
    expect(envelope.payload.format).toBe(QLIK_CHUNK_FORMAT);
    expect(envelope.payload.parts?.length).toBeGreaterThan(1);

    const downloaded = await service.download(admin, 'artifact-1', 'data');
    const downloadedRows = (downloaded.payload as { rows: Array<{ name: string }> }).rows;
    expect(downloadedRows).toHaveLength(4_000);
    expect(downloadedRows[0]?.name).toContain('row-0-');
    expect(downloadedRows[3_999]?.name).toContain('row-3999-');
  });

  it('reshapes a cleaned Qlik extract into a named row array', async () => {
    const { repository, service } = createService();
    vi.mocked(repository.getQlikBinding).mockResolvedValue({
      artifactId: 'artifact-1', datasetKey: 'data', appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a', objectId: 'WuPA',
      refreshHourUtc: 8, refreshMinuteUtc: 0, enabled: true, lastPulledAt: null, lastError: null, lastRecordCount: 2,
      nextDueAt: '2026-08-22T08:00:00.000Z', updatedAt: '2026-08-21T22:00:00.000Z',
      transform: { output: 'rows', keys: 'title', keepColumns: [], dropEmptyRows: false, rowFilterMode: 'and', rowFilters: [] },
    });
    await service.upload(admin, 'artifact-1', 'data', {
      asOf: '2026-08-21T22:00:00.000Z',
      appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a',
      objectId: 'WuPA',
      columns: [{ key: 'name', title: 'Name', role: 'dimension' }],
      rows: [['A'], ['B']],
    });
    const envelope = await service.download(admin, 'artifact-1', 'data');
    expect(envelope.payload).toEqual([{ Name: 'A' }, { Name: 'B' }]);
  });
});
