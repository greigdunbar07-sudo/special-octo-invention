import { resolve } from 'node:path';

import { packageArtifact } from '../dist-server/scripts/artifact-package.mjs';

const html = '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script></head><body><canvas id="chart"></canvas></body></html>';
const packaged = await packageArtifact({
  title: 'Production layout smoke test', kind: 'report', owner: 'CI', html, root: resolve('.'),
});
if (packaged.files['index.html'].includes('cdn.jsdelivr.net') || !packaged.compatibility.transformations.some((item) => item.code === 'SCRIPT_INLINED')) {
  throw new Error('The deployed packager could not resolve bundled Chart.js from the application root.');
}
console.log('Validated the artifact packager from the deployed dist-server filesystem layout.');
