// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../server/app';
import type { AppConfig } from '../../server/config';

const config: AppConfig = {
  port: 8080,
  tenantId: 'f5a44614-2e0f-46dd-89af-a59b298f02af',
  bootstrapAdminEmail: 'greig.dunbar@covetrus.com',
  sqlServer: '', sqlDatabase: '', storageAccount: '', storageContainer: 'portal-data',
  staticRoot: resolve('dist'), artifactRoot: resolve('artifacts'), bundleRoot: resolve('tmp/portal-data'), production: false, usageTelemetryMode: 'off', usageInsightsEnabled: false, usageEventRetentionDays: 180,
};

describe('Azure container HTTP surface', () => {
  const app = createApp(config);

  it('exposes an anonymous shallow health check with security headers', async () => {
    const response = await request(app).get('/healthz').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  it('serves the SPA fallback', async () => {
    await request(app).get('/admin').expect('Content-Type', /html/).expect(200);
  });

  it('serves bundled artifact HTML with a sandbox CSP when a bundle is present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-serve-'));
    const slug = 'csp-fixture';
    mkdirSync(join(root, slug));
    writeFileSync(join(root, slug, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, id: slug, title: 'Fixture', kind: 'report', version: '1.0.0',
      entry: 'index.html', owner: 'Operations', capabilities: ['downloads'],
      datasets: [{ key: 'data', schemaVersion: 1, maxBytes: 1024, schema: 'data.schema.json' }],
    }));
    writeFileSync(join(root, slug, 'data.schema.json'), '{}');
    writeFileSync(join(root, slug, 'index.html'), '<html><body>fixture</body></html>');
    const fixtureApp = createApp({ ...config, artifactRoot: root });
    try {
      const artifact = await request(fixtureApp).get(`/artifacts/${slug}/index.html?v=1.0.0`).expect('Content-Type', /html/).expect(200);
      expect(artifact.headers['cache-control']).toContain('no-store');
      expect(artifact.headers['content-security-policy']).toContain('sandbox allow-scripts allow-downloads');
      expect(artifact.headers['content-security-policy']).toContain("form-action 'none'");
      expect(artifact.headers['content-security-policy']).toContain("base-uri 'none'");
      expect(artifact.text).toContain('fixture');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns the structured API error contract for unknown routes', async () => {
    const response = await request(app).get('/api/not-a-route').expect(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('requires Microsoft sign-in before an artifact can be published', async () => {
    await request(app).post('/api/admin/artifacts').expect(401);
  });

  it('requires Microsoft sign-in before an app can be linked', async () => {
    await request(app).post('/api/admin/artifacts/links').send({
      title: 'Better Buying', description: 'Supplier buying workspace', kind: 'tool', owner: 'Commercial',
      url: 'https://covetrus-better-buying.azurewebsites.net/',
    }).expect(401);
  });

  it('requires Microsoft sign-in before users or published artifacts can be deleted', async () => {
    await request(app).delete('/api/admin/users/user-1').expect(401);
    await request(app).delete('/api/admin/artifacts/artifact-1').expect(401);
  });

  it('requires Microsoft sign-in before usage events or insights can be accessed', async () => {
    await request(app).post('/api/usage/events').send({ events: [] }).expect(401);
    await request(app).get('/api/admin/usage-insights?range=28d').expect(401);
  });

  it('requires Microsoft sign-in before an access request can be read, submitted, or resolved', async () => {
    const read = await request(app).get('/api/portal/access-request').expect(401);
    expect(read.body.error.code).toBe('AUTH_REQUIRED');
    await request(app).post('/api/portal/access-request').send({ note: 'Please let me in.' }).expect(401);
    await request(app).post('/api/admin/access-requests/request-1/approve').expect(401);
    await request(app).post('/api/admin/access-requests/request-1/dismiss').expect(401);
  });

  it('requires Microsoft sign-in before a Qlik dataset source can be saved or pulled', async () => {
    await request(app).put('/api/admin/artifacts/artifact-1/datasets/report/qlik').send({ appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'obj' }).expect(401);
    await request(app).post('/api/admin/artifacts/artifact-1/datasets/report/qlik/pull').expect(401);
    await request(app).delete('/api/admin/artifacts/artifact-1/datasets/report/qlik').expect(401);
    await request(app).get('/api/admin/qlik/apps').expect(401);
    await request(app).get('/api/admin/qlik/apps/1df4cf94-0a3b-4246-848e-40200247bfba/tables').expect(401);
    await request(app).post('/api/admin/qlik/preview').send({ appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'obj' }).expect(401);
  });

  it('accepts multipart artifact requests without treating the body as JSON', async () => {
    const response = await request(app)
      .post('/api/admin/artifacts')
      .field('title', 'SPC Test')
      .field('description', 'SPC for PDOL')
      .field('kind', 'report')
      .field('owner', 'Greig Dunbar')
      .attach('file', Buffer.from('<html><body>SPC</body></html>'), 'PDOL_SKU_Watchlist_SPC.html')
      .expect(401);

    expect(response.body).toEqual({ error: { code: 'AUTH_REQUIRED', message: 'Microsoft sign-in is required.' } });
  });

  it('requires Microsoft sign-in before preflight can stage an upload', async () => {
    const response = await request(app)
      .post('/api/admin/artifacts/preflight')
      .attach('file', Buffer.from('<html><body>SPC</body></html>'), 'Customer_Watchlist_SPC.html')
      .expect(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});
