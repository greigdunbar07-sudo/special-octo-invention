// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../server/config.js';
import { PortalStorage } from '../../server/storage.js';

describe('PortalStorage prefix deletion', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it('deletes only the requested artifact tree from local storage', async () => {
    const bundleRoot = mkdtempSync(join(tmpdir(), 'portal-storage-'));
    roots.push(bundleRoot);
    const config: AppConfig = {
      port: 8080, tenantId: 'tenant', bootstrapAdminEmail: 'admin@example.com', sqlServer: '', sqlDatabase: '', storageAccount: '',
      storageContainer: 'portal-data', staticRoot: 'dist', artifactRoot: 'artifacts', bundleRoot, production: false, usageTelemetryMode: 'off', usageInsightsEnabled: false, usageEventRetentionDays: 180,
    };
    const storage = new PortalStorage(config);
    await storage.put('bundles/delete-me/1.0.0/index.html', Buffer.from('deleted'), 'text/html');
    await storage.put('bundles/keep-me/1.0.0/index.html', Buffer.from('kept'), 'text/html');

    await storage.deletePrefix('bundles/delete-me');

    expect(existsSync(join(bundleRoot, 'bundles', 'delete-me'))).toBe(false);
    expect(readFileSync(join(bundleRoot, 'bundles', 'keep-me', '1.0.0', 'index.html'), 'utf8')).toBe('kept');
  });

  it('rejects traversal prefixes', async () => {
    const bundleRoot = mkdtempSync(join(tmpdir(), 'portal-storage-'));
    roots.push(bundleRoot);
    const storage = new PortalStorage({
      port: 8080, tenantId: 'tenant', bootstrapAdminEmail: 'admin@example.com', sqlServer: '', sqlDatabase: '', storageAccount: '',
      storageContainer: 'portal-data', staticRoot: 'dist', artifactRoot: 'artifacts', bundleRoot, production: false, usageTelemetryMode: 'off', usageInsightsEnabled: false, usageEventRetentionDays: 180,
    });

    await expect(storage.deletePrefix('../outside')).rejects.toMatchObject({ code: 'INVALID_BUNDLE_PATH' });
  });
});
