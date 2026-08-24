// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HOST_SHIM,
  ARTIFACT_HTML_CSP,
  PackageError,
  assertSafeZipPath,
  detectEmbeddedData,
  injectHostShim,
  packageArtifact,
  refreshHostShim,
  rewriteAllowlistedCdns,
  slugify,
} from '../../scripts/artifact-package.mjs';

const vendorFiles = new Map<string, Buffer>([
  ['vendor/chart.umd.js', Buffer.from('window.Chart=function(){}')],
  ['vendor/hammer.min.js', Buffer.from('window.Hammer={}')],
  ['vendor/chartjs-plugin-zoom.min.js', Buffer.from('window.ChartZoom={}')],
  ['vendor/instrument-sans.woff2', Buffer.from('font')],
]);

describe('artifact package contract', () => {
  it('allows artifacts to be embedded only by the same-origin portal', () => {
    expect(ARTIFACT_HTML_CSP).toContain("frame-ancestors 'self'");
    expect(ARTIFACT_HTML_CSP).toContain("form-action 'none'");
    expect(ARTIFACT_HTML_CSP).toContain("base-uri 'none'");
    expect(ARTIFACT_HTML_CSP).toContain('sandbox allow-scripts');
    expect(ARTIFACT_HTML_CSP).not.toContain("frame-ancestors 'none'");
  });

  it('rewrites allowlisted Chart.js CDNs and injects the host shim', () => {
    const html = rewriteAllowlistedCdns('<html><head></head><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script></html>');
    expect(html).toContain('vendor/chart.umd.js');
    expect(injectHostShim('<html><head><title>x</title></head></html>')).toContain(HOST_SHIM.slice(0, 40));
    expect(() => new Function(HOST_SHIM)).not.toThrow();
    expect(HOST_SHIM).toContain("replace(/\\\\/g, '/')");
    expect(HOST_SHIM).toContain('payloadJson');
    expect(HOST_SHIM).toContain('flushJson()');
    expect(HOST_SHIM).toContain("type: 'download'");
    expect(HOST_SHIM).toContain('portalBlobs.get(this.href)');
    expect(HOST_SHIM).toContain('portalLatestBlob');
  });

  it('refreshes an older packaged host shim without changing artifact code', () => {
    const oldShim = `(function(){window.__PORTAL_SHIM__=true;window.protocol='covetrus.portal.bridge';window.oldBridge=true})();`;
    const refreshed = refreshHostShim(`<html><head><script>${oldShim}</script></head><body><script>window.artifactCode=true</script></body></html>`);
    expect(refreshed).toContain("type: 'download'");
    expect(refreshed).not.toContain('oldBridge');
    expect(refreshed).toContain('window.artifactCode=true');
  });

  it('allows embedded data in self-contained HTML and rejects it when JSON is supplied', async () => {
    expect(detectEmbeddedData('const RAW = { d: [] }')).toBe(true);
    const packaged = await packageArtifact({
      title: 'Fill rate', kind: 'report', owner: 'Operations',
      html: '<html><head></head><body><script>const RAW = { d: [1] }</script></body></html>',
      vendorFiles,
    });
    expect(packaged.mode).toBe('self-contained');
    expect(packaged.files['index.html']).toContain('__PORTAL_DATA__');

    await expect(packageArtifact({
      title: 'Fill rate', kind: 'report', owner: 'Operations',
      html: '<html><head></head><body><script>const RAW = { d: [1] }</script></body></html>',
      attachments: { 'data.json': Buffer.from('{"ok":true}') },
      vendorFiles,
    })).rejects.toThrow(PackageError);
  });

  it('snapshots public HTTPS scripts and records their hash', async () => {
    const script = Buffer.from('window.RemoteDependency=true');
    const packaged = await packageArtifact({
      title: 'Remote', kind: 'report', owner: 'Operations',
      html: '<html><script src="https://static.example/x.js"></script></html>',
      vendorFiles,
      fetchRemote: async () => ({ status: 200, bytes: script, contentType: 'text/javascript' }),
      resolveDns: async () => [{ address: '93.184.216.34' }],
    });
    expect(packaged.files['index.html']).toContain('window.RemoteDependency=true');
    expect(packaged.files['index.html']).not.toContain('https://static.example');
    expect(packaged.compatibility.dependencies).toEqual([expect.objectContaining({
      url: 'https://static.example/x.js',
      sha256: createHash('sha256').update(script).digest('hex'),
    })]);
  });

  it('recursively inlines zip-relative CSS, fonts, and binary images', async () => {
    const png = Buffer.from([0, 255, 1, 254, 2, 253]);
    const packaged = await packageArtifact({
      title: 'Assets', kind: 'report', owner: 'Operations',
      html: '<html><head><link rel="stylesheet" href="styles/main.css"></head><body><img src="images/logo.png"></body></html>',
      files: new Map([
        ['styles/main.css', Buffer.from('@import "./theme.css"; .logo{font-family:x}')],
        ['styles/theme.css', Buffer.from('@font-face{font-family:x;src:url("../fonts/x.woff2")}')],
        ['fonts/x.woff2', Buffer.from([1, 2, 3, 4])],
        ['images/logo.png', png],
      ]),
      vendorFiles,
    });
    expect(packaged.files['index.html']).toContain(png.toString('base64'));
    expect(packaged.files['index.html']).toContain('data:font/woff2;base64');
    expect(packaged.files['index.html']).not.toContain('styles/main.css');
  });

  it('verifies integrity and blocks private addresses before fetching', async () => {
    await expect(packageArtifact({
      title: 'Integrity', kind: 'report', owner: 'Operations',
      html: '<html><script src="https://static.example/x.js" integrity="sha256-bad"></script></html>',
      vendorFiles,
      fetchRemote: async () => ({ status: 200, bytes: Buffer.from('different'), contentType: 'text/javascript' }),
      resolveDns: async () => [{ address: '93.184.216.34' }],
    })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    await expect(packageArtifact({
      title: 'Private', kind: 'report', owner: 'Operations',
      html: '<html><script src="https://127.0.0.1/x.js"></script></html>', vendorFiles,
    })).rejects.toMatchObject({ code: 'PRIVATE_REMOTE_ASSET' });
  });

  it('returns actionable locations for unsupported runtime features', async () => {
    await expect(packageArtifact({
      title: 'Live app', kind: 'tool', owner: 'Operations',
      html: '<html>\n<body>\n<script>fetch("https://api.example/data")</script></body></html>', vendorFiles,
    })).rejects.toMatchObject({ code: 'LIVE_NETWORK_REQUIRED', source: expect.stringContaining('line 3') });
  });

  it('revalidates redirect targets and rejects a redirect to a private address', async () => {
    const fetchRemote = vi.fn(async () => ({ status: 302, location: 'https://127.0.0.1/internal.js', bytes: Buffer.alloc(0) }));
    await expect(packageArtifact({
      title: 'Redirect', kind: 'report', owner: 'Operations',
      html: '<html><script src="https://static.example/x.js"></script></html>', vendorFiles, fetchRemote,
      resolveDns: async () => [{ address: '93.184.216.34' }],
    })).rejects.toMatchObject({ code: 'PRIVATE_REMOTE_ASSET' });
    expect(fetchRemote).toHaveBeenCalledOnce();
  });

  it('declares a JSON dataset slot from a relative fetch even when no JSON file is attached', async () => {
    const packaged = await packageArtifact({
      title: 'Fetch report', kind: 'report', owner: 'Operations',
      html: '<html><script>fetch("data.json").then(response => response.json())</script></html>',
      vendorFiles,
    });
    expect(packaged.mode).toBe('data-separated');
    expect(packaged.manifest.datasets).toEqual([expect.objectContaining({ key: 'data' })]);
    expect(packaged.datasets).toEqual([]);
  });

  it('protects attached JSON and shims relative JSON fetches', async () => {
    const packaged = await packageArtifact({
      title: 'JSON report', kind: 'report', owner: 'Operations',
      html: '<html><script>fetch("data/report.json").then(response => response.json())</script></html>',
      attachments: { 'report.json': Buffer.from('{"value":42}') }, vendorFiles,
    });
    expect(packaged.mode).toBe('data-separated');
    expect(packaged.datasets).toEqual([expect.objectContaining({ key: 'report', payload: { value: 42 } })]);
    expect(packaged.manifest.datasets).toEqual([expect.objectContaining({ key: 'report', schema: 'report.schema.json' })]);
    expect(packaged.files).toHaveProperty('report.schema.json');
    expect(packaged.files).not.toHaveProperty('[object Object]');
    expect(packaged.files['index.html']).toContain('pendingJson');
    expect(packaged.files).not.toHaveProperty('report.json');
  });

  it('enforces remote resource, per-resource, and normalized output limits', async () => {
    const scripts = Array.from({ length: 33 }, (_, index) => `<script src="https://static.example/${index}.js"></script>`).join('');
    await expect(packageArtifact({
      title: 'Too many', kind: 'report', owner: 'Operations', html: `<html>${scripts}</html>`, vendorFiles,
      fetchRemote: async () => ({ status: 200, bytes: Buffer.from('window.x=1'), contentType: 'text/javascript' }),
      resolveDns: async () => [{ address: '93.184.216.34' }],
    })).rejects.toMatchObject({ code: 'REMOTE_LIMIT_EXCEEDED' });

    await expect(packageArtifact({
      title: 'Too large', kind: 'report', owner: 'Operations', html: '<html><script src="https://static.example/large.js"></script></html>', vendorFiles,
      fetchRemote: async () => ({ status: 200, bytes: Buffer.alloc(5 * 1024 * 1024 + 1), contentType: 'text/javascript' }),
      resolveDns: async () => [{ address: '93.184.216.34' }],
    })).rejects.toMatchObject({ code: 'REMOTE_LIMIT_EXCEEDED' });

    await expect(packageArtifact({
      title: 'Expanded', kind: 'report', owner: 'Operations', html: '<html><img src="large.png"></html>', vendorFiles,
      files: new Map([['large.png', Buffer.alloc(15 * 1024 * 1024)]]),
    })).rejects.toMatchObject({ code: 'REMOTE_LIMIT_EXCEEDED' });
  });

  it('packages the sanitized Customer Watchlist fixture from source and the deployed runtime layout', async () => {
    const fixture = resolve('src/__tests__/fixtures/Customer_Watchlist_SPC.html');
    const html = readFileSync(fixture, 'utf8');
    const packaged = await packageArtifact({ title: 'Customer Watchlist', kind: 'report', owner: 'Operations', html, root: resolve('.') });
    expect(packaged.files['index.html']).not.toContain('cdn.jsdelivr.net');
    expect(packaged.compatibility.transformations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SCRIPT_INLINED' })]));

    const copied = spawnSync(process.execPath, [resolve('scripts/copy-runtime-package.mjs')], { encoding: 'utf8' });
    expect(copied.status, copied.stderr).toBe(0);
    const smoke = spawnSync(process.execPath, ['--input-type=module', '-e', `import {readFileSync} from 'node:fs'; import {resolve} from 'node:path'; import {packageArtifact} from './dist-server/scripts/artifact-package.mjs'; const html=readFileSync(${JSON.stringify(fixture)},'utf8'); const value=await packageArtifact({title:'Customer Watchlist',kind:'report',owner:'Operations',html,root:resolve('.')}); if(value.files['index.html'].includes('cdn.jsdelivr.net')) process.exit(2);`], { cwd: resolve('.'), encoding: 'utf8' });
    expect(smoke.status, smoke.stderr).toBe(0);
  });

  it('rejects zip entries that escape the package root', () => {
    expect(() => assertSafeZipPath('../evil.html')).toThrow(/invalid/i);
    expect(() => assertSafeZipPath('/tmp/evil.html')).toThrow(/invalid/i);
    expect(() => assertSafeZipPath('ok/index.html')).not.toThrow();
  });

  it('slugifies titles', () => {
    expect(slugify('Weekly Fill Rate')).toBe('weekly-fill-rate');
    expect(() => slugify('???')).toThrow(PackageError);
  });
});

describe('artifacts:import CLI', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const path of created) rmSync(path, { recursive: true, force: true });
  });


  it('writes a bundled folder and keeps JSON in private-seed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'insight-import-'));
    const html = join(dir, 'index.html');
    writeFileSync(html, '<html><head></head><body>ok</body></html>');
    const json = join(dir, 'rates.json');
    writeFileSync(json, '{"rate":1}');
    const slug = 'tmp-publish-cli';
    created.push(resolve('artifacts', slug), resolve('private-seed', slug));
    const result = spawnSync(process.execPath, [
      resolve('scripts/import-artifact.mjs'), '--from', html, '--title', 'CLI import', '--kind', 'tool',
      '--owner', 'Warehouse', '--slug', slug, '--json', json, '--replace',
    ], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/private-seed/);
  });
});
