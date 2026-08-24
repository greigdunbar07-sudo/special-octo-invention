import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { extname, join, posix, relative, resolve, sep } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import JSZip from 'jszip';
import { parse, serialize } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

export const BRIDGE_PROTOCOL = 'covetrus.portal.bridge';
export const ALLOWED_CAPABILITIES = new Set(['downloads']);
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_ZIP_BYTES = 15 * 1024 * 1024;
export const MAX_JSON_BYTES = 10 * 1024 * 1024;
export const MAX_DATASET_BYTES = 10 * 1024 * 1024;
export const MAX_NORMALIZED_HTML_BYTES = 20 * 1024 * 1024;
export const MAX_REMOTE_RESOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_REMOTE_TOTAL_BYTES = 12 * 1024 * 1024;
export const MAX_REMOTE_RESOURCES = 32;
export const MAX_EXTRACTED_ZIP_BYTES = 20 * 1024 * 1024;
export const PERMISSIVE_SCHEMA = { type: ['object', 'array'] };
export const ARTIFACT_HTML_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors 'self'; sandbox allow-scripts";

export function artifactHtmlCsp(allowDownloads = false) {
  return allowDownloads ? `${ARTIFACT_HTML_CSP} allow-downloads` : ARTIFACT_HTML_CSP;
}
export const PREFLIGHT_PROTOCOL = 'covetrus.portal.preflight';

const EMBEDDED_DATA = /const\s+RAW\s*=\s*\{|var\s+DEFAULTS\s*=\s*\{/i;
const OVERSIZED_SCRIPT = /<script[^>]*>[\s\S]{1048576,}<\/script>/i;
const REMOTE_ASSET = /<(?:script|img|link|source|video|audio)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//i;
const REMOTE_IMPORT = /@import\s+url\(["']?https?:\/\//i;

export class PackageError extends Error {
  constructor(message, code = 'ARTIFACT_INVALID', source, issues) {
    super(message);
    this.name = 'PackageError';
    this.code = code;
    this.source = source;
    this.issues = issues ?? [{ code, message, source, remediation: remediationFor(code) }];
  }
}

function remediationFor(code) {
  const messages = {
    MODULE_SCRIPT: 'Export a classic browser script or bundle the module before uploading.',
    LIVE_NETWORK_REQUIRED: 'Embed the required data or attach it as JSON instead of calling a live service.',
    EMBEDDED_PAGE: 'Replace the embedded page with static content.',
    WORKER_REQUIRED: 'Bundle the worker logic into the main page.',
    INSECURE_REMOTE_ASSET: 'Use a public HTTPS dependency.',
    PRIVATE_REMOTE_ASSET: 'Use a public HTTPS dependency; private and local network addresses are not permitted.',
    MISSING_LOCAL_ASSET: 'Zip the HTML together with every referenced local file.',
    REMOTE_LIMIT_EXCEEDED: 'Reduce or bundle dependencies before uploading.',
    INTEGRITY_MISMATCH: 'Update the dependency or its integrity attribute so they match.',
    MEDIA_UNSUPPORTED: 'Replace audio or video with a static image or remove it from the artifact.',
    POPUP_REQUIRED: 'Render the content in the current page or provide it as a permitted download instead of opening a new window.',
    CSS_INVALID: 'Correct the stylesheet syntax and run compatibility checking again.',
    REMOTE_DEPENDENCY_FAILED: 'Check that the public HTTPS dependency is available and try again.',
  };
  return messages[code] ?? 'Update the HTML package and run compatibility checking again.';
}

export function slugify(value) {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new PackageError('Enter a title that can be turned into a URL slug.');
  return slug;
}

export function bumpVersion(version) {
  const match = String(version ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return '1.0.1';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function htmlHasBridge(html) {
  return html.includes(BRIDGE_PROTOCOL);
}

export function detectEmbeddedData(html) {
  return EMBEDDED_DATA.test(html) || OVERSIZED_SCRIPT.test(html);
}

export function loadVendorFiles(root = process.cwd()) {
  const files = new Map();
  const entries = [
    ['vendor/chart.umd.js', 'node_modules/chart.js/dist/chart.umd.js'],
    ['vendor/hammer.min.js', 'node_modules/hammerjs/hammer.min.js'],
    ['vendor/chartjs-plugin-zoom.min.js', 'node_modules/chartjs-plugin-zoom/dist/chartjs-plugin-zoom.min.js'],
    ['vendor/instrument-sans.woff2', 'node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2'],
  ];
  for (const [name, source] of entries) {
    const path = join(root, source);
    if (existsSync(path)) files.set(name, readFileSync(path));
  }
  return files;
}

export function rewriteAllowlistedCdns(html) {
  let output = html;
  output = output.replace(/<script\b[^>]*\bsrc=["']https?:\/\/(?:cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js|cdn\.jsdelivr\.net\/npm\/chart\.js)[^"']*["'][^>]*>\s*<\/script>/gi, '<script src="vendor/chart.umd.js"><\/script>');
  output = output.replace(/<script\b[^>]*\bsrc=["']https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/hammer\.js[^"']*["'][^>]*>\s*<\/script>/gi, '<script src="vendor/hammer.min.js"><\/script>');
  output = output.replace(/<script\b[^>]*\bsrc=["']https?:\/\/(?:cdnjs\.cloudflare\.com\/ajax\/libs\/chartjs-plugin-zoom|cdn\.jsdelivr\.net\/npm\/chartjs-plugin-zoom)[^"']*["'][^>]*>\s*<\/script>/gi, '<script src="vendor/chartjs-plugin-zoom.min.js"><\/script>');
  output = output.replace(/@import\s+url\(["']?https:\/\/fonts\.googleapis\.com[^"')]*["']?\);?/gi, "@font-face{font-family:'Instrument Sans';src:url('vendor/instrument-sans.woff2') format('woff2');font-weight:400 700;font-style:normal;font-display:swap}");
  output = output.replace(/<link\b[^>]*\bhref=["']https:\/\/fonts\.googleapis\.com[^"']*["'][^>]*>/gi, '');
  return output;
}

export const HOST_SHIM = `(function(){
  'use strict';
  if (window.__PORTAL_SHIM__) return;
  window.__PORTAL_SHIM__ = true;
  window.__PORTAL_DATA__ = null;
  var portalPort = null;
  var portalBlobs = new Map();
  var portalLatestBlob = null;
  var nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  var nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function(value) {
    var url = nativeCreateObjectURL(value);
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      portalBlobs.set(url, value);
      portalLatestBlob = value;
    }
    return url;
  };
  URL.revokeObjectURL = function(url) {
    portalBlobs.delete(String(url));
    return nativeRevokeObjectURL(url);
  };
  if (typeof HTMLAnchorElement !== 'undefined') {
    var nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      var rawHref = this.getAttribute('href') || '';
      var blob = this.download && (portalBlobs.get(rawHref) || portalBlobs.get(this.href));
      if (!blob && this.download && String(this.href).indexOf('blob:') === 0) blob = portalLatestBlob;
      if (blob && portalPort) {
        portalPort.postMessage({ protocol: '${BRIDGE_PROTOCOL}', version: 1, type: 'download', filename: this.download, blob: blob });
        return;
      }
      return nativeAnchorClick.call(this);
    };
  }
  window.__PORTAL_DATASETS__ = {};
  var started = false, pendingJson = [], jsonText = {};
  var nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  function datasetKey(value) {
    var path = String(value || '').split(/[?#]/)[0].replace(/\\\\/g, '/');
    var name = path.slice(path.lastIndexOf('/') + 1).replace(/\\.json$/i, '');
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data';
  }
  function hasJson(key) {
    return Object.prototype.hasOwnProperty.call(jsonText, key) || Object.prototype.hasOwnProperty.call(window.__PORTAL_DATASETS__, key);
  }
  function jsonResponse(key) {
    var body = Object.prototype.hasOwnProperty.call(jsonText, key) ? jsonText[key] : JSON.stringify(window.__PORTAL_DATASETS__[key]);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (nativeFetch) window.fetch = function(resource, init) {
    var value = typeof resource === 'string' ? resource : resource && resource.url;
    if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value) && /\\.json(?:[?#]|$)/i.test(value)) {
      var key = datasetKey(value);
      if (started) return hasJson(key) ? Promise.resolve(jsonResponse(key)) : Promise.reject(new Error('The packaged JSON dataset "' + key + '" was not supplied.'));
      return new Promise(function(resolve, reject) { pendingJson.push({ key: key, resolve: resolve, reject: reject }); });
    }
    return nativeFetch(resource, init);
  };
  function flushJson() {
    for (var i = 0; i < pendingJson.length; i += 1) {
      var item = pendingJson[i];
      if (hasJson(item.key)) item.resolve(jsonResponse(item.key));
      else item.reject(new Error('The packaged JSON dataset "' + item.key + '" was not supplied.'));
    }
    pendingJson = [];
  }
  function preview(type, detail) {
    try { window.parent.postMessage({ protocol: '${PREFLIGHT_PROTOCOL}', version: 1, type: type, detail: detail || '' }, '*'); } catch (error) { /* parent messaging may be unavailable */ }
  }
  window.addEventListener('error', function(event) { preview('error', event.message || 'A preview resource failed to load.'); }, true);
  window.addEventListener('unhandledrejection', function(event) { preview('error', String(event.reason && event.reason.message || event.reason || 'Unhandled promise rejection.')); });
  window.addEventListener('securitypolicyviolation', function(event) { preview('error', 'Blocked by the artifact security policy: ' + event.violatedDirective); });
  window.addEventListener('load', function() { setTimeout(function() { preview('ready'); }, 250); });
  window.addEventListener('message', function(event) {
    var message = event.data, port = event.ports && event.ports[0];
    if (!port || !message || message.protocol !== '${BRIDGE_PROTOCOL}' || message.version !== 1 || message.type !== 'connect') return;
    portalPort = port;
    port.onmessage = function(reply) {
      var data = reply.data;
      if (!data || data.protocol !== '${BRIDGE_PROTOCOL}' || data.version !== 1 || data.type !== 'init' || started) return;
      started = true;
      var datasets = data.datasets || [];
      var map = {};
      for (var i = 0; i < datasets.length; i += 1) {
        var entry = datasets[i];
        if (typeof entry.payloadJson === 'string') jsonText[entry.datasetKey] = entry.payloadJson;
        if (entry.payload != null) map[entry.datasetKey] = entry.payload;
      }
      window.__PORTAL_DATASETS__ = map;
      flushJson();
      for (var j = 0; j < datasets.length; j += 1) {
        var later = datasets[j];
        if (map[later.datasetKey] != null) continue;
        if (typeof later.payloadJson !== 'string') continue;
        try { map[later.datasetKey] = JSON.parse(later.payloadJson); } catch (error) { map[later.datasetKey] = null; }
      }
      window.__PORTAL_DATA__ = datasets[0] ? map[datasets[0].datasetKey] : null;
      try { window.dispatchEvent(new CustomEvent('portaldata', { detail: window.__PORTAL_DATA__ })); } catch (error) { /* CustomEvent may be unavailable in older hosts */ }
      port.postMessage({ protocol: '${BRIDGE_PROTOCOL}', version: 1, type: 'initialized' });
    };
    port.start();
    port.postMessage({ protocol: '${BRIDGE_PROTOCOL}', version: 1, type: 'ready' });
  });
})();`;

export function injectHostShim(html) {
  if (htmlHasBridge(html)) return html;
  const script = `<script>${HOST_SHIM}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}${script}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}${script}`);
  return `${script}${html}`;
}

export function refreshHostShim(html) {
  if (!html.includes('__PORTAL_SHIM__')) return injectHostShim(html);
  const document = parse(html);
  let replaced = false;
  walkNodes(document, (node) => {
    if (replaced || node.tagName?.toLowerCase() !== 'script') return;
    const body = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
    if (!body.includes('__PORTAL_SHIM__') || !body.includes(BRIDGE_PROTOCOL)) return;
    node.childNodes = [{ nodeName: '#text', value: HOST_SHIM, parentNode: node }];
    replaced = true;
  });
  return replaced ? serialize(document) : injectHostShim(html);
}

function localAsset(base, source, files) {
  if (/^(?:[a-z]+:|\/)/i.test(source)) return null;
  const normalised = source.replace(/\\/g, '/').replace(/^\.\//, '');
  if (files?.has(normalised)) return { kind: 'map', path: normalised };
  if (!base) return null;
  const path = resolve(base, source);
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new PackageError(`Artifact asset escapes its bundle: ${source}`);
  if (!existsSync(path)) return null;
  return { kind: 'disk', path };
}

export function inlineHtml(html, options = {}) {
  const base = options.base ? resolve(options.base) : null;
  const files = options.files ?? new Map();
  const read = (asset) => {
    if (asset.kind === 'map') return Buffer.isBuffer(files.get(asset.path)) ? files.get(asset.path) : Buffer.from(String(files.get(asset.path)));
    return readFileSync(asset.path);
  };
  let output = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, before, source, after) => {
    const asset = localAsset(base, source, files);
    if (!asset) return tag;
    const body = read(asset).toString('utf8').replace(/<\/script/gi, '<\\/script');
    return `<script${before}${after}>${body}</script>`;
  });
  output = output.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (value, _quote, source) => {
    const asset = localAsset(base, source, files);
    if (!asset || extname(asset.path).toLowerCase() !== '.woff2') return value;
    return `url('data:font/woff2;base64,${read(asset).toString('base64')}')`;
  });
  if (/<script\b[^>]*\bsrc=["'][^"']+["']/i.test(output)) throw new PackageError('Production artifact retains a script dependency.');
  if (/url\(\s*["']?vendor\//i.test(output)) throw new PackageError('Production artifact retains a font dependency.');
  return output;
}

function attr(node, name) {
  return node.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function setAttr(node, name, value) {
  node.attrs ??= [];
  const existing = node.attrs.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}

function removeAttr(node, name) {
  if (node.attrs) node.attrs = node.attrs.filter((item) => item.name.toLowerCase() !== name.toLowerCase());
}

function walkNodes(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walkNodes(child, visit);
  if (node.content) walkNodes(node.content, visit);
}

function replaceNode(node, replacement) {
  const siblings = node.parentNode?.childNodes;
  if (!siblings) return;
  const index = siblings.indexOf(node);
  if (index >= 0) {
    replacement.parentNode = node.parentNode;
    siblings.splice(index, 1, replacement);
  }
}

function removeNode(node) {
  const siblings = node.parentNode?.childNodes;
  if (!siblings) return;
  const index = siblings.indexOf(node);
  if (index >= 0) siblings.splice(index, 1);
}

function issue(code, message, source) {
  return { code, message, source, remediation: remediationFor(code) };
}

function nodeSource(node, fallback) {
  const location = node.sourceCodeLocation?.startTag ?? node.sourceCodeLocation;
  return location?.startLine ? `${fallback} (line ${location.startLine}, column ${location.startCol})` : fallback;
}

function collectCompatibilityIssues(document) {
  const blockers = [];
  const warnings = [];
  walkNodes(document, (node) => {
    const tag = node.tagName?.toLowerCase();
    if (['iframe', 'object', 'embed'].includes(tag)) blockers.push(issue('EMBEDDED_PAGE', `${tag} content cannot run inside the protected viewer.`, nodeSource(node, tag)));
    if (['audio', 'video'].includes(tag)) blockers.push(issue('MEDIA_UNSUPPORTED', `${tag} content is not supported in static artifacts.`, nodeSource(node, tag)));
    if (tag === 'script' && String(attr(node, 'type') ?? '').toLowerCase() === 'module') blockers.push(issue('MODULE_SCRIPT', 'JavaScript modules must be bundled into a classic script before publishing.', nodeSource(node, attr(node, 'src') || 'inline script')));
    if (tag === 'form' && attr(node, 'action')) warnings.push(issue('FORM_SUBMISSION_DISABLED', 'Form submission is disabled in the protected viewer.', nodeSource(node, attr(node, 'action'))));
    if (tag === 'script' && !attr(node, 'src')) {
      const body = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
      if (/\b(?:new\s+)?(?:WebSocket|EventSource|SharedWorker|Worker)\s*\(|navigator\.serviceWorker/i.test(body)) blockers.push(issue('WORKER_REQUIRED', 'Workers, service workers, WebSockets, and event streams are not available in static artifacts.', nodeSource(node, 'inline script')));
      const fetchCalls = [...body.matchAll(/\bfetch\s*\(\s*([^,)\r\n]+)/gi)];
      const unsafeFetch = fetchCalls.some((match) => !/^["'](?!\/\/|[a-z][a-z0-9+.-]*:)[^"']+\.json(?:[?#][^"']*)?["']$/i.test(match[1].trim()));
      if (unsafeFetch || /\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b/i.test(body)) blockers.push(issue('LIVE_NETWORK_REQUIRED', 'Live API requests are not available in static artifacts.', nodeSource(node, 'inline script')));
      if (/\b(?:window\.)?open\s*\(/i.test(body)) blockers.push(issue('POPUP_REQUIRED', 'New windows and pop-ups are not available in the protected viewer.', nodeSource(node, 'inline script')));
    }
  });
  return { blockers, warnings };
}

function isPrivateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase().split('%')[0];
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff') || value.startsWith('2001:db8:') || value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.');
}

async function assertPublicHttps(value, resolveDns = lookup) {
  let url;
  try { url = new URL(value); } catch { throw new PackageError(`Remote dependency URL is invalid: ${value}`, 'INSECURE_REMOTE_ASSET', value); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) throw new PackageError(`Only public HTTPS dependencies on port 443 are supported: ${value}`, 'INSECURE_REMOTE_ASSET', value);
  let addresses;
  try { addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await resolveDns(url.hostname, { all: true, verbatim: true }); }
  catch { throw new PackageError(`The dependency host could not be resolved: ${value}`, 'REMOTE_DEPENDENCY_FAILED', value); }
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new PackageError(`Private or reserved dependency addresses are not permitted: ${value}`, 'PRIVATE_REMOTE_ASSET', value);
  return url;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyIntegrity(bytes, integrity, source) {
  if (!integrity) return;
  const candidates = integrity.trim().split(/\s+/).map((item) => item.match(/^(sha256|sha384|sha512)-(.+)$/)).filter(Boolean);
  if (!candidates.length) return;
  const valid = candidates.some((match) => createHash(match[1]).update(bytes).digest('base64') === match[2]);
  if (!valid) throw new PackageError(`The integrity hash does not match ${source}.`, 'INTEGRITY_MISMATCH', source);
}

function contentTypeForReference(reference, fallback = 'application/octet-stream') {
  const pathname = (() => { try { return new URL(reference).pathname; } catch { return reference; } })().split(/[?#]/)[0].toLowerCase();
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
  return types[extname(pathname)] ?? fallback;
}

function localReference(reference, baseName) {
  const clean = reference.split(/[?#]/)[0].replace(/\\/g, '/');
  const combined = posix.normalize(posix.join(posix.dirname(baseName || 'index.html'), clean)).replace(/^\.\//, '');
  if (!combined || combined === '..' || combined.startsWith('../') || combined.startsWith('/')) throw new PackageError(`Artifact asset escapes its bundle: ${reference}`, 'MISSING_LOCAL_ASSET', reference);
  return combined;
}

async function fetchPublicAsset(reference, context) {
  if (context.remoteCount >= MAX_REMOTE_RESOURCES) throw new PackageError('The artifact references more than 32 remote resources.', 'REMOTE_LIMIT_EXCEEDED', reference);
  const startedAt = Date.now();
  let current = reference;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicHttps(current, context.resolveDns);
    let response;
    try {
      response = context.fetchRemote
        ? await context.fetchRemote(current)
        : await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(Math.min(10_000, Math.max(1, 30_000 - (Date.now() - context.startedAt)))) });
    } catch (error) {
      if (error instanceof PackageError) throw error;
      throw new PackageError(`The dependency could not be downloaded: ${current}`, 'REMOTE_DEPENDENCY_FAILED', current);
    }
    const status = Number(response.status ?? 200);
    const location = typeof response.headers?.get === 'function' ? response.headers.get('location') : response.location;
    if (status >= 300 && status < 400 && location) {
      try { current = new URL(location, current).href; }
      catch { throw new PackageError(`The dependency returned an invalid redirect: ${current}`, 'REMOTE_DEPENDENCY_FAILED', current); }
      continue;
    }
    if (status < 200 || status >= 300) throw new PackageError(`Dependency returned HTTP ${status}: ${current}`, 'REMOTE_DEPENDENCY_FAILED', current);
    let bytes;
    try { bytes = Buffer.isBuffer(response.bytes) ? response.bytes : Buffer.from(response.bytes ?? await response.arrayBuffer()); }
    catch { throw new PackageError(`The dependency body could not be read: ${current}`, 'REMOTE_DEPENDENCY_FAILED', current); }
    if (bytes.byteLength > MAX_REMOTE_RESOURCE_BYTES) throw new PackageError(`Remote dependency exceeds the 5 MB limit: ${current}`, 'REMOTE_LIMIT_EXCEEDED', current);
    context.remoteCount += 1;
    context.remoteBytes += bytes.byteLength;
    if (context.remoteBytes > MAX_REMOTE_TOTAL_BYTES || Date.now() - context.startedAt > 30_000) throw new PackageError('Remote dependencies exceed the total size or time limit.', 'REMOTE_LIMIT_EXCEEDED', current);
    const contentType = response.contentType ?? (typeof response.headers?.get === 'function' ? response.headers.get('content-type') : '') ?? contentTypeForReference(current);
    context.dependencies.push({ url: current, sha256: sha256(bytes), sizeBytes: bytes.byteLength, contentType: String(contentType).split(';')[0] });
    return { bytes, contentType: String(contentType).split(';')[0] || contentTypeForReference(current), reference: current, elapsedMs: Date.now() - startedAt };
  }
  throw new PackageError(`Dependency redirects more than three times: ${reference}`, 'REMOTE_LIMIT_EXCEEDED', reference);
}

async function resolveDependency(reference, baseReference, context, integrity) {
  if (/^(?:data:|blob:|#)/i.test(reference)) return null;
  if (/^\/\//.test(reference)) throw new PackageError(`Protocol-relative dependencies are not supported: ${reference}`, 'INSECURE_REMOTE_ASSET', reference);
  if (/^http:/i.test(reference)) throw new PackageError(`Insecure remote dependency: ${reference}`, 'INSECURE_REMOTE_ASSET', reference);
  if (/^https:/i.test(reference) || /^https:/i.test(baseReference)) {
    const resolved = new URL(reference, /^https:/i.test(baseReference) ? baseReference : undefined).href;
    const asset = await fetchPublicAsset(resolved, context);
    verifyIntegrity(asset.bytes, integrity, resolved);
    return asset;
  }
  const path = localReference(reference, baseReference);
  const value = context.files.get(path);
  if (value === undefined) throw new PackageError(`The referenced local asset is missing: ${reference}`, 'MISSING_LOCAL_ASSET', reference);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  verifyIntegrity(bytes, integrity, path);
  return { bytes, contentType: contentTypeForReference(path), reference: path, elapsedMs: 0 };
}

function dataUrl(asset) {
  return `data:${asset.contentType || 'application/octet-stream'};base64,${asset.bytes.toString('base64')}`;
}

async function replaceCssUrls(value, baseReference, context) {
  const parsed = valueParser(value);
  const nodes = [];
  parsed.walk((node) => { if (node.type === 'function' && node.value.toLowerCase() === 'url') nodes.push(node); });
  for (const node of nodes) {
    const reference = valueParser.stringify(node.nodes).trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
    const asset = await resolveDependency(reference, baseReference, context);
    if (!asset) continue;
    node.nodes = [{ type: 'string', quote: '"', value: dataUrl(asset), sourceIndex: 0, sourceEndIndex: 0 }];
    context.transformations.push({ code: 'ASSET_INLINED', source: asset.reference, message: 'Embedded a CSS asset into the artifact.' });
  }
  return parsed.toString();
}

async function normalizeCss(css, baseReference, context, depth = 0) {
  if (depth > 8) throw new PackageError('Stylesheet imports are nested too deeply.', 'REMOTE_LIMIT_EXCEEDED', baseReference);
  let root;
  try { root = postcss.parse(css, { from: baseReference }); }
  catch { throw new PackageError(`Stylesheet syntax is invalid: ${baseReference}`, 'CSS_INVALID', baseReference); }
  const imports = [];
  root.walkAtRules('import', (rule) => imports.push(rule));
  for (const rule of imports) {
    const match = rule.params.match(/^(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/i);
    if (!match) continue;
    const asset = await resolveDependency(match[1], baseReference, context);
    if (!asset) continue;
    const nested = await normalizeCss(asset.bytes.toString('utf8'), asset.reference, context, depth + 1);
    rule.replaceWith(...postcss.parse(nested).nodes);
    context.transformations.push({ code: 'STYLESHEET_INLINED', source: asset.reference, message: 'Embedded an imported stylesheet.' });
  }
  const declarations = [];
  root.walkDecls((declaration) => declarations.push(declaration));
  for (const declaration of declarations) declaration.value = await replaceCssUrls(declaration.value, baseReference, context);
  return root.toString();
}

export async function normalizeStaticHtml(html, options = {}) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const compatibility = collectCompatibilityIssues(document);
  if (compatibility.blockers.length) throw new PackageError(compatibility.blockers[0].message, compatibility.blockers[0].code, compatibility.blockers[0].source, compatibility.blockers);
  const context = {
    files: options.files ?? new Map(), fetchRemote: options.fetchRemote, resolveDns: options.resolveDns, startedAt: Date.now(), remoteCount: 0, remoteBytes: 0,
    dependencies: [], transformations: [], warnings: compatibility.warnings,
  };
  const nodes = [];
  walkNodes(document, (node) => nodes.push(node));
  for (const node of nodes) {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'script' && attr(node, 'src')) {
      const source = attr(node, 'src');
      const asset = await resolveDependency(source, options.entryName ?? 'index.html', context, attr(node, 'integrity'));
      if (!asset) continue;
      removeAttr(node, 'src'); removeAttr(node, 'integrity'); removeAttr(node, 'crossorigin'); removeAttr(node, 'referrerpolicy');
      node.childNodes = [{ nodeName: '#text', value: asset.bytes.toString('utf8').replace(/<\/script/gi, '<\\/script'), parentNode: node }];
      context.transformations.push({ code: 'SCRIPT_INLINED', source: asset.reference, message: 'Embedded a script dependency.' });
    } else if (tag === 'style') {
      const css = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
      const normalized = await normalizeCss(css, options.entryName ?? 'index.html', context);
      node.childNodes = [{ nodeName: '#text', value: normalized, parentNode: node }];
    } else if (tag === 'link' && String(attr(node, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      const source = attr(node, 'href');
      if (!source) continue;
      const asset = await resolveDependency(source, options.entryName ?? 'index.html', context, attr(node, 'integrity'));
      const css = await normalizeCss(asset.bytes.toString('utf8'), asset.reference, context);
      replaceNode(node, { nodeName: 'style', tagName: 'style', attrs: [], namespaceURI: 'http://www.w3.org/1999/xhtml', childNodes: [{ nodeName: '#text', value: css }] });
      context.transformations.push({ code: 'STYLESHEET_INLINED', source: asset.reference, message: 'Embedded a stylesheet dependency.' });
    } else if (tag === 'link' && ['preconnect', 'dns-prefetch'].includes(String(attr(node, 'rel') ?? '').toLowerCase())) {
      removeNode(node);
      context.transformations.push({ code: 'NETWORK_HINT_REMOVED', source: attr(node, 'href') || tag, message: 'Removed a runtime network hint.' });
    } else if ((tag === 'img' || tag === 'source') && attr(node, 'src')) {
      const source = attr(node, 'src');
      const asset = await resolveDependency(source, options.entryName ?? 'index.html', context);
      if (asset) { setAttr(node, 'src', dataUrl(asset)); context.transformations.push({ code: 'IMAGE_INLINED', source: asset.reference, message: 'Embedded an image dependency.' }); }
    } else if ((tag === 'img' || tag === 'source') && attr(node, 'srcset')) {
      const values = attr(node, 'srcset').split(',');
      const normalized = [];
      for (const value of values) {
        const [source, ...descriptor] = value.trim().split(/\s+/);
        const asset = await resolveDependency(source, options.entryName ?? 'index.html', context);
        normalized.push(`${asset ? dataUrl(asset) : source}${descriptor.length ? ` ${descriptor.join(' ')}` : ''}`);
      }
      setAttr(node, 'srcset', normalized.join(', '));
    } else if (tag === 'link' && String(attr(node, 'rel') ?? '').toLowerCase().split(/\s+/).includes('icon') && attr(node, 'href')) {
      const asset = await resolveDependency(attr(node, 'href'), options.entryName ?? 'index.html', context);
      if (asset) { setAttr(node, 'href', dataUrl(asset)); context.transformations.push({ code: 'ICON_INLINED', source: asset.reference, message: 'Embedded an icon dependency.' }); }
    }
  }
  const normalizedCompatibility = collectCompatibilityIssues(document);
  if (normalizedCompatibility.blockers.length) {
    const blocker = normalizedCompatibility.blockers[0];
    throw new PackageError(blocker.message, blocker.code, blocker.source, normalizedCompatibility.blockers);
  }
  const output = serialize(document);
  if (Buffer.byteLength(output) > MAX_NORMALIZED_HTML_BYTES) throw new PackageError('The normalized artifact exceeds the 20 MB limit.', 'REMOTE_LIMIT_EXCEEDED', options.entryName ?? 'index.html');
  return { html: output, dependencies: context.dependencies, transformations: context.transformations, warnings: context.warnings, inputBytes: Buffer.byteLength(html), normalizedBytes: Buffer.byteLength(output) };
}

export function validateManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object') throw new PackageError('manifest.json is missing');
  for (const key of ['schemaVersion', 'id', 'title', 'kind', 'version', 'entry', 'owner', 'capabilities', 'datasets']) {
    if (!(key in manifest)) throw new PackageError(`manifest field ${key} is missing`);
  }
  if (manifest.schemaVersion !== 1) throw new PackageError('unsupported manifest schemaVersion');
  if (!['report', 'tool'].includes(manifest.kind)) throw new PackageError('kind must be report or tool');
  if (!Array.isArray(manifest.capabilities)) throw new PackageError('capabilities must be an array');
  for (const capability of manifest.capabilities) {
    if (!ALLOWED_CAPABILITIES.has(capability)) throw new PackageError(`unsafe capability ${capability}`);
  }
  if (!Array.isArray(manifest.datasets)) throw new PackageError('datasets must be an array');
  for (const dataset of manifest.datasets) {
    if (!dataset?.key) throw new PackageError('dataset key is missing');
    if ((dataset.maxBytes ?? MAX_DATASET_BYTES) > MAX_DATASET_BYTES) throw new PackageError(`${dataset.key} exceeds the v1 size contract`);
  }
  return manifest;
}

export function validateHtml(html, options = {}) {
  if (typeof html !== 'string' || !html.trim()) throw new PackageError('The artifact HTML is empty.');
  const limit = options.normalized ? MAX_NORMALIZED_HTML_BYTES : MAX_HTML_BYTES;
  if (Buffer.byteLength(html) > limit) throw new PackageError(options.normalized ? 'The normalized HTML exceeds the 20 MB limit.' : 'The HTML file exceeds the 5 MB limit.');
  if (REMOTE_ASSET.test(html) || REMOTE_IMPORT.test(html)) throw new PackageError('remote dependency detected');
  const selfContained = options.selfContained === true || (options.datasetCount ?? 0) === 0;
  if (!selfContained && detectEmbeddedData(html)) throw new PackageError('embedded operational data or rate card detected');
}

export function datasetKeyFromFileName(name) {
  return posix.basename(name).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data';
}

export function datasetKeysFromHtml(html) {
  const keys = [];
  const seen = new Set();
  const pattern = /\bfetch\s*\(\s*["'](?!\/\/|[a-z][a-z0-9+.-]*:)([^"']+\.json)(?:[?#][^"']*)?["']/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const key = datasetKeyFromFileName(match[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function flattenZipPaths(paths) {
  const normalised = paths.map((path) => path.replace(/\\/g, '/').replace(/^\/+/, ''));
  const files = normalised.filter((path) => path && !path.endsWith('/'));
  if (files.length === 0) return new Map();
  const prefixes = files.map((path) => path.split('/')[0]);
  const common = prefixes.every((item) => item === prefixes[0]) && files.every((path) => path.includes('/')) ? `${prefixes[0]}/` : '';
  const map = new Map();
  for (const path of files) {
    const relativePath = common && path.startsWith(common) ? path.slice(common.length) : path;
    if (!relativePath || relativePath.includes('..') || path.startsWith('/') || path.includes(':')) throw new PackageError('Zip entry path is invalid.');
    map.set(path, relativePath);
  }
  return map;
}

export function assertSafeZipPath(name) {
  const normalised = String(name ?? '').replace(/\\/g, '/');
  if (!normalised || normalised.includes('..') || normalised.startsWith('/') || /(?:^|\/)[a-zA-Z]:/.test(normalised)) {
    throw new PackageError('Zip entry path is invalid.');
  }
}

export async function extractZip(buffer) {
  if (!buffer || buffer.byteLength > MAX_ZIP_BYTES) throw new PackageError('The zip file exceeds the 15 MB limit.');
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  for (const name of names) assertSafeZipPath(name);
  const mapping = flattenZipPaths(names);
  const files = new Map();
  let extractedBytes = 0;
  for (const [original, relativePath] of mapping) {
    const entry = zip.files[original];
    if (entry.unsafe || relativePath.includes('..')) throw new PackageError('Zip entry path is invalid.');
    const bytes = Buffer.from(await entry.async('nodebuffer'));
    extractedBytes += bytes.byteLength;
    if (extractedBytes > MAX_EXTRACTED_ZIP_BYTES) throw new PackageError('The extracted zip package exceeds the 20 MB limit.', 'REMOTE_LIMIT_EXCEEDED', relativePath);
    files.set(relativePath, bytes);
  }
  return files;
}

function parseJsonFile(name, bytes) {
  if (bytes.byteLength > MAX_JSON_BYTES) throw new PackageError(`${name} exceeds the 10 MB dataset limit.`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PackageError(`${name} is not valid JSON.`);
  }
}

function findHtml(files, entryName = 'index.html') {
  if (files.has(entryName)) return { name: entryName, html: files.get(entryName).toString('utf8') };
  const htmlFiles = [...files.keys()].filter((name) => name.toLowerCase().endsWith('.html') && !name.includes('/'));
  if (htmlFiles.length === 1) return { name: htmlFiles[0], html: files.get(htmlFiles[0]).toString('utf8') };
  const nested = [...files.keys()].filter((name) => name.toLowerCase().endsWith('.html'));
  if (nested.length === 1) return { name: nested[0], html: files.get(nested[0]).toString('utf8') };
  throw new PackageError('The package must contain a single HTML entry file.');
}

function readOptionalManifest(files) {
  if (!files.has('manifest.json')) return null;
  try {
    return JSON.parse(files.get('manifest.json').toString('utf8'));
  } catch {
    throw new PackageError('manifest.json is not valid JSON.');
  }
}

export function buildManifest(input) {
  const datasets = input.datasets ?? [];
  return {
    schemaVersion: 1,
    id: input.slug,
    title: input.title,
    description: input.description ?? '',
    kind: input.kind,
    version: input.version ?? '1.0.0',
    entry: 'index.html',
    owner: input.owner,
    dataDate: input.dataDate || undefined,
    capabilities: input.capabilities ?? [],
    datasets: datasets.map((dataset) => ({
      key: dataset.key,
      schemaVersion: dataset.schemaVersion ?? 1,
      required: dataset.required !== false,
      maxBytes: dataset.maxBytes ?? MAX_DATASET_BYTES,
      schema: typeof dataset.schema === 'string' ? dataset.schema : `${dataset.key}.schema.json`,
    })),
  };
}

export async function packageArtifact(input) {
  const files = new Map(input.files ?? []);
  if (input.zip) {
    const extracted = await extractZip(input.zip);
    for (const [name, bytes] of extracted) files.set(name, bytes);
  }
  if (input.html) files.set(input.htmlName ?? 'index.html', Buffer.from(input.html));
  for (const [name, bytes] of Object.entries(input.attachments ?? {})) files.set(name, Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)));

  const suppliedManifest = readOptionalManifest(files);
  const slug = input.slug || suppliedManifest?.id || slugify(input.title);

  const htmlEntry = findHtml(files, suppliedManifest?.entry ?? 'index.html');
  const vendor = input.vendorFiles ?? loadVendorFiles(input.root ?? process.cwd());
  let html = rewriteAllowlistedCdns(htmlEntry.html);
  const inlineFiles = new Map(files);
  for (const [name, bytes] of vendor) inlineFiles.set(name, bytes);
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new PackageError('The HTML file exceeds the 5 MB limit.');
  const normalization = await normalizeStaticHtml(html, { files: inlineFiles, entryName: htmlEntry.name, fetchRemote: input.fetchRemote, resolveDns: input.resolveDns });
  html = injectHostShim(normalization.html);

  const jsonFiles = [...files.entries()].filter(([name]) => name.toLowerCase().endsWith('.json') && !name.toLowerCase().endsWith('.schema.json') && posix.basename(name) !== 'manifest.json');
  const extraDatasets = input.datasets ?? [];
  const datasets = [];
  const seen = new Set();
  for (const extra of extraDatasets) {
    if (seen.has(extra.key)) continue;
    seen.add(extra.key);
    datasets.push(extra);
  }
  for (const [name, bytes] of jsonFiles) {
    const key = datasetKeyFromFileName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    datasets.push({ key, payload: parseJsonFile(name, bytes), schema: files.has(`${key}.schema.json`) ? JSON.parse(files.get(`${key}.schema.json`).toString('utf8')) : PERMISSIVE_SCHEMA });
  }
  for (const key of datasetKeysFromHtml(html)) {
    if (seen.has(key)) continue;
    seen.add(key);
    datasets.push({ key, schema: PERMISSIVE_SCHEMA });
  }

  const manifestInput = suppliedManifest ? {
    ...suppliedManifest,
    id: slug,
    title: input.title ?? suppliedManifest.title,
    description: input.description ?? suppliedManifest.description ?? '',
    kind: input.kind ?? suppliedManifest.kind,
    version: input.version ?? suppliedManifest.version ?? '1.0.0',
    owner: input.owner ?? suppliedManifest.owner,
    dataDate: input.dataDate ?? suppliedManifest.dataDate,
    capabilities: input.capabilities ?? suppliedManifest.capabilities,
    entry: 'index.html',
    datasets: datasets.length ? datasets.map((dataset) => ({
      key: dataset.key,
      schemaVersion: 1,
      required: true,
      maxBytes: MAX_DATASET_BYTES,
      schema: `${dataset.key}.schema.json`,
    })) : (Array.isArray(suppliedManifest.datasets) ? suppliedManifest.datasets : []),
  } : buildManifest({
    slug,
    title: input.title,
    description: input.description ?? '',
    kind: input.kind,
    version: input.version ?? '1.0.0',
    owner: input.owner,
    dataDate: input.dataDate,
    capabilities: input.capabilities ?? [],
    datasets,
  });

  const manifest = validateManifest(manifestInput, { allowReserved: input.allowReserved });
  validateHtml(html, { selfContained: manifest.datasets.length === 0, datasetCount: manifest.datasets.length, normalized: true });

  const ajv = new Ajv({ allErrors: true });
  const outputFiles = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'index.html': html,
  };
  const packagedDatasets = [];
  for (const contract of manifest.datasets) {
    const schema = datasets.find((item) => item.key === contract.key)?.schema
      ?? (files.has(contract.schema ?? `${contract.key}.schema.json`) ? JSON.parse(files.get(contract.schema ?? `${contract.key}.schema.json`).toString('utf8')) : PERMISSIVE_SCHEMA);
    ajv.compile(schema);
    outputFiles[contract.schema ?? `${contract.key}.schema.json`] = `${JSON.stringify(schema, null, 2)}\n`;
    const payload = datasets.find((item) => item.key === contract.key)?.payload;
    if (payload !== undefined) packagedDatasets.push({ key: contract.key, payload, schema });
  }

  return {
    manifest,
    files: outputFiles,
    datasets: packagedDatasets,
    mode: manifest.datasets.length === 0 ? 'self-contained' : 'data-separated',
    compatibility: {
      inputBytes: normalization.inputBytes,
      normalizedBytes: Buffer.byteLength(html),
      dependencies: normalization.dependencies,
      transformations: normalization.transformations,
      warnings: normalization.warnings,
    },
  };
}

export function validateArtifactDirectory(directory, options = {}) {
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) throw new PackageError('manifest.json is missing');
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), options);
  const entry = join(directory, manifest.entry);
  if (!existsSync(entry)) throw new PackageError(`entry ${manifest.entry} is missing`);
  const html = readFileSync(entry, 'utf8');
  validateHtml(html, { selfContained: manifest.datasets.length === 0, datasetCount: manifest.datasets.length });
  const ajv = new Ajv({ allErrors: true });
  for (const dataset of manifest.datasets) {
    const schemaPath = join(directory, dataset.schema ?? `${dataset.key}.schema.json`);
    if (!existsSync(schemaPath)) throw new PackageError(`schema for ${dataset.key} is missing`);
    ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  }
  return manifest;
}

export function inlineHtmlFile(entryPath, targetRoot) {
  const html = inlineHtml(readFileSync(entryPath, 'utf8'), { base: resolve(entryPath, '..') });
  if (targetRoot && relative(targetRoot, entryPath).startsWith('..')) throw new PackageError('Artifact asset escapes its bundle.');
  return html;
}
