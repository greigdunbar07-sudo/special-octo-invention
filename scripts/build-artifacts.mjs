import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { inlineHtml } from './artifact-package.mjs';

const root = resolve(import.meta.dirname, '..');
const validation = spawnSync(process.execPath, [join(root, 'scripts/validate-artifacts.mjs')], { stdio: 'inherit' });
if (validation.status !== 0) process.exit(validation.status ?? 1);

const target = join(root, 'public', 'artifacts');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(root, 'artifacts'), target, { recursive: true });

for (const folder of readdirSync(target)) {
  const base = join(target, folder);
  if (!statSync(base).isDirectory() || folder.startsWith('_') || !existsSync(join(base, 'manifest.json'))) continue;
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'));
  const entryPath = join(base, manifest.entry);
  writeFileSync(entryPath, inlineHtml(readFileSync(entryPath, 'utf8'), { base }));
  rmSync(join(base, 'vendor'), { recursive: true, force: true });
}

console.log('Copied and self-contained validated artifacts into the static build.');
