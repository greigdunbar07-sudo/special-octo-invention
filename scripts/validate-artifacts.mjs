import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { validateArtifactDirectory } from './artifact-package.mjs';

const root = resolve(import.meta.dirname, '..');
const artifactsDir = join(root, 'artifacts');
const ids = new Set();
let failures = 0;

for (const folder of readdirSync(artifactsDir)) {
  const base = join(artifactsDir, folder);
  if (!statSync(base).isDirectory() || folder.startsWith('_') || !existsSync(join(base, 'manifest.json'))) continue;
  try {
    const manifest = validateArtifactDirectory(base);
    if (ids.has(manifest.id)) throw new Error(`duplicate id ${manifest.id}`);
    ids.add(manifest.id);
    console.log(`✓ ${manifest.id} ${manifest.version}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${folder}: ${error instanceof Error ? error.message : error}`);
  }
}

if (failures) process.exitCode = 1;
else console.log(`Validated ${ids.size} artifact bundles.`);
