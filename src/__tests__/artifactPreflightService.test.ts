// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactRegistry } from '../../server/artifacts.js';
import type { AppConfig } from '../../server/config.js';
import type { DatasetService } from '../../server/datasets.js';
import { ArtifactPublishService } from '../../server/publish.js';
import type { PortalRepository } from '../../server/repository.js';
import { PortalStorage } from '../../server/storage.js';
import type { PortalIdentity } from '../types/portal.js';

const admin: PortalIdentity = {
  id: 'admin-a', tenantId: 'tenant-a', entraObjectId: 'entra-a', email: 'admin@example.com', displayName: 'Admin A', role: 'admin', status: 'active',
};
const otherAdmin: PortalIdentity = { ...admin, id: 'admin-b', entraObjectId: 'entra-b', email: 'other@example.com', displayName: 'Admin B' };

describe('ArtifactPublishService preflight staging', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function createService() {
    const bundleRoot = mkdtempSync(join(tmpdir(), 'artifact-preflight-'));
    roots.push(bundleRoot);
    const config: AppConfig = {
      port: 8080, tenantId: admin.tenantId, bootstrapAdminEmail: admin.email, sqlServer: '', sqlDatabase: '', storageAccount: '', storageContainer: 'portal-data',
      staticRoot: resolve('dist'), artifactRoot: resolve('artifacts'), bundleRoot, production: false, usageTelemetryMode: 'off', usageInsightsEnabled: false, usageEventRetentionDays: 180,
    };
    const repository = {
      requireAdmin: vi.fn(),
      getArtifactBySlug: vi.fn(async () => null),
      upsertUploadedArtifact: vi.fn(async (_actor, input) => ({
        id: 'uploaded-1', slug: input.slug, title: input.title, description: input.description, kind: input.kind, version: input.version,
        owner: input.owner, dataDate: input.dataDate, entryUrl: input.entryUrl, capabilities: input.capabilities, datasetKeys: input.datasetKeys,
        accent: 'teal', source: 'uploaded',
      })),
      deleteUploadedArtifact: vi.fn(async () => ({ slug: 'live-report', storageLocations: ['live-report/data/checksum.json'] })),
    } as unknown as PortalRepository;
    const datasets = { upload: vi.fn(async () => undefined) } as unknown as DatasetService;
    const storage = new PortalStorage(config);
    return { bundleRoot, repository, storage, service: new ArtifactPublishService(new ArtifactRegistry(resolve('artifacts')), repository, datasets, storage) };
  }

  it('publishes the exact staged package once and binds it to its administrator', async () => {
    const { service } = createService();
    const report = await service.preflight(admin, { html: Buffer.from('<html><body>safe</body></html>') });
    expect(report).toMatchObject({ status: 'ready', blockers: [] });
    if (report.status !== 'ready') throw new Error('Preflight did not return a token.');
    await expect(service.preview(otherAdmin, report.preflightToken)).rejects.toMatchObject({ code: 'PREFLIGHT_EXPIRED' });

    const published = await service.publish(admin, {
      title: 'Staged report', description: 'Checked package', kind: 'report', owner: 'Operations', preflightToken: report.preflightToken,
    }, {});
    expect(published.slug).toBe('staged-report');
    await expect(service.publish(admin, {
      title: 'Staged report', description: 'Checked package', kind: 'report', owner: 'Operations', preflightToken: report.preflightToken,
    }, {})).rejects.toMatchObject({ code: 'PREFLIGHT_EXPIRED' });
  });

  it('publishes a staged JSON-backed artifact with a safe schema filename', async () => {
    const { bundleRoot, service } = createService();
    const report = await service.preflight(admin, {
      html: Buffer.from('<html><body><script>fetch("data.json")</script></body></html>'),
      json: [{ name: 'data.json', bytes: Buffer.from('{"value":42}') }],
    });
    expect(report).toMatchObject({ status: 'ready', blockers: [] });
    if (report.status !== 'ready') throw new Error('Preflight did not return a token.');

    await expect(service.publish(admin, {
      title: 'JSON report', description: 'Checked package', kind: 'report', owner: 'Operations', preflightToken: report.preflightToken,
    }, {})).resolves.toMatchObject({ slug: 'json-report', datasetKeys: ['data'] });
    expect(existsSync(join(bundleRoot, 'bundles', 'json-report', '1.0.0', 'data.schema.json'))).toBe(true);
    expect(existsSync(join(bundleRoot, 'bundles', 'json-report', '1.0.0', '[object Object]'))).toBe(false);
  });

  it('expires staged packages and returns structured blockers', async () => {
    const { bundleRoot, service } = createService();
    const blocked = await service.preflight(admin, { html: Buffer.from('<html>\n<script type="module">export default 1</script></html>') });
    expect(blocked).toMatchObject({ status: 'blocked', blockers: [expect.objectContaining({ code: 'MODULE_SCRIPT', source: expect.stringContaining('line 2') })] });

    const ready = await service.preflight(admin, { html: Buffer.from('<html><body>safe</body></html>') });
    if (ready.status !== 'ready') throw new Error('Preflight did not return a token.');
    const stagePath = join(bundleRoot, 'staging', admin.tenantId, admin.id, `${ready.preflightToken}.json`);
    const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as { expiresAt: string };
    stage.expiresAt = new Date(0).toISOString();
    writeFileSync(stagePath, JSON.stringify(stage));
    await expect(service.preview(admin, ready.preflightToken)).rejects.toMatchObject({ code: 'PREFLIGHT_EXPIRED' });
  });

  it('deletes live bundle versions and protected dataset blobs', async () => {
    const { bundleRoot, repository, service, storage } = createService();
    await storage.put('bundles/live-report/1.0.0/index.html', Buffer.from('report'), 'text/html');
    await storage.put('live-report/data/checksum.json', Buffer.from('{}'), 'application/json');

    await service.delete(admin, 'uploaded-1');

    expect(repository.deleteUploadedArtifact).toHaveBeenCalledWith(admin, 'uploaded-1');
    expect(existsSync(join(bundleRoot, 'bundles', 'live-report'))).toBe(false);
    expect(existsSync(join(bundleRoot, 'live-report', 'data', 'checksum.json'))).toBe(false);
  });
});
