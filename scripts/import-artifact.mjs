import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

import { PackageError, bumpVersion, packageArtifact, slugify } from './artifact-package.mjs';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) return fallback;
  return process.argv[index + 1];
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function collect(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function usage() {
  console.error(`Usage:
  npm run artifacts:import -- --from path\\to\\file.html --title "Weekly fill rate" --kind report --owner "Operations"
  npm run artifacts:import -- --from path\\to\\tool.zip --title "Slotting helper" --kind tool --owner "Warehouse" --json path\\to\\rates.json`);
}

const root = resolve(import.meta.dirname, '..');
const source = arg('from');
const title = arg('title');
const kind = arg('kind');
const owner = arg('owner');
const description = arg('description');
const dataDate = arg('data-date');
const slug = arg('slug');
const version = arg('version');
const replace = flag('replace');
const downloads = flag('downloads');

if (!source || !title || !kind || !owner) {
  usage();
  process.exit(1);
}

try {
  const resolved = resolve(source);
  if (!existsSync(resolved)) throw new PackageError(`File not found: ${resolved}`);
  const extension = extname(resolved).toLowerCase();
  const attachments = {};
  for (const jsonPath of collect('json')) {
    const file = resolve(jsonPath);
    if (!existsSync(file)) throw new PackageError(`JSON file not found: ${file}`);
    attachments[`${jsonPath.split(/[/\\]/).pop()}`] = readFileSync(file);
  }

  const targetSlug = slug || slugify(title);
  const artifactDir = join(root, 'artifacts', targetSlug);
  if (existsSync(join(artifactDir, 'manifest.json')) && !replace) {
    throw new PackageError(`${targetSlug} already exists. Pass --replace to overwrite it.`);
  }

  let nextVersion = version || '1.0.0';
  if (replace && existsSync(join(artifactDir, 'manifest.json'))) {
    const current = JSON.parse(readFileSync(join(artifactDir, 'manifest.json'), 'utf8'));
    nextVersion = version || bumpVersion(current.version);
  }

  const packaged = await packageArtifact({
    title,
    description,
    kind,
    owner,
    dataDate,
    slug: targetSlug,
    version: nextVersion,
    capabilities: downloads ? ['downloads'] : [],
    html: extension === '.html' || extension === '.htm' ? readFileSync(resolved, 'utf8') : undefined,
    zip: extension === '.zip' ? readFileSync(resolved) : undefined,
    attachments,
    root,
  });

  if (existsSync(artifactDir)) rmSync(artifactDir, { recursive: true, force: true });
  for (const [name, content] of Object.entries(packaged.files)) {
    const path = join(artifactDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  if (packaged.datasets.length) {
    const seedDir = join(root, 'private-seed', targetSlug);
    mkdirSync(seedDir, { recursive: true });
    for (const dataset of packaged.datasets) {
      writeFileSync(join(seedDir, `${dataset.key}.json`), `${JSON.stringify(dataset.payload, null, 2)}\n`);
    }
    console.log(`Wrote protected JSON to private-seed/${targetSlug}/ (gitignored). After deploy, import it in Administration.`);
  }

  console.log(`Imported ${packaged.manifest.id} ${packaged.manifest.version} (${packaged.mode}) into artifacts/${targetSlug}/`);
  console.log('Next: commit the artifact folder, then ./scripts/release-azure.ps1. Sign in as admin after the new image is live.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
