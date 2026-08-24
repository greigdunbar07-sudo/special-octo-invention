import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const destination = join(root, 'dist-server', 'scripts');
mkdirSync(destination, { recursive: true });
copyFileSync(join(root, 'scripts', 'artifact-package.mjs'), join(destination, 'artifact-package.mjs'));
