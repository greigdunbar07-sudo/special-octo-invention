// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { artifactEntryUrl, ArtifactRegistry } from '../../server/artifacts';

describe('artifact registry identifiers', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('matches SQL uniqueidentifier values without case sensitivity', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-registry-'));
    roots.push(root);
    const dir = join(root, 'sample-report');
    mkdirSync(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, id: 'sample-report', title: 'Sample', kind: 'report', version: '1.0.0',
      entry: 'index.html', owner: 'Operations', capabilities: [],
      datasets: [{ key: 'data', schemaVersion: 1, maxBytes: 1024, schema: 'data.schema.json' }],
    }));
    writeFileSync(join(dir, 'data.schema.json'), '{}');
    writeFileSync(join(dir, 'index.html'), '<html></html>');

    const registry = new ArtifactRegistry(root);
    const artifact = registry.entries.find((entry) => entry.manifest.id === 'sample-report');

    expect(artifact).toBeDefined();
    expect(registry.byDatabaseId(artifact!.databaseId.toUpperCase(), 'data')).toBe(artifact);
  });

  it('versions artifact entry URLs for immediate cache invalidation', () => {
    expect(artifactEntryUrl({ id: 'sample-report', entry: 'index.html', version: '1.0.1' }))
      .toBe('/artifacts/sample-report/index.html?v=1.0.1');
  });

  it('loads an empty artifacts directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-registry-empty-'));
    roots.push(root);
    expect(new ArtifactRegistry(root).entries).toEqual([]);
  });
});
