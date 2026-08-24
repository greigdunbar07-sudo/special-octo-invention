export const BRIDGE_PROTOCOL: string;
export const ALLOWED_CAPABILITIES: Set<string>;
export const MAX_HTML_BYTES: number;
export const MAX_ZIP_BYTES: number;
export const MAX_JSON_BYTES: number;
export const MAX_DATASET_BYTES: number;
export const MAX_NORMALIZED_HTML_BYTES: number;
export const MAX_EXTRACTED_ZIP_BYTES: number;
export const PERMISSIVE_SCHEMA: { type: string[] };
export const ARTIFACT_HTML_CSP: string;
export function artifactHtmlCsp(allowDownloads?: boolean): string;
export const PREFLIGHT_PROTOCOL: string;
export const HOST_SHIM: string;

export class PackageError extends Error {
  code: string;
  source?: string;
  issues: Array<{ code: string; message: string; source?: string; remediation: string }>;
  constructor(message: string, code?: string, source?: string, issues?: Array<{ code: string; message: string; source?: string; remediation: string }>);
}

export interface ArtifactManifest {
  schemaVersion: number;
  id: string;
  title: string;
  description?: string;
  kind: 'report' | 'tool';
  version: string;
  entry: string;
  owner: string;
  dataDate?: string;
  capabilities: string[];
  datasets: Array<{
    key: string;
    schemaVersion: number;
    required?: boolean;
    maxBytes: number;
    schema?: string;
  }>;
}

export interface PackagedArtifact {
  manifest: ArtifactManifest;
  files: Record<string, string>;
  datasets: Array<{ key: string; payload: unknown; schema: unknown }>;
  mode: 'self-contained' | 'data-separated';
  compatibility: {
    inputBytes: number;
    normalizedBytes: number;
    dependencies: Array<{ url: string; sha256: string; sizeBytes: number; contentType: string }>;
    transformations: Array<{ code: string; source: string; message: string }>;
    warnings: Array<{ code: string; message: string; source?: string; remediation: string }>;
  };
}

export function slugify(value: string): string;
export function bumpVersion(version: string): string;
export function htmlHasBridge(html: string): boolean;
export function detectEmbeddedData(html: string): boolean;
export function loadVendorFiles(root?: string): Map<string, Buffer>;
export function rewriteAllowlistedCdns(html: string): string;
export function injectHostShim(html: string): string;
export function refreshHostShim(html: string): string;
export function inlineHtml(html: string, options?: { base?: string; files?: Map<string, Buffer | string> }): string;
export function normalizeStaticHtml(html: string, options?: {
  files?: Map<string, Buffer | string>;
  entryName?: string;
  fetchRemote?: (url: string) => Promise<unknown>;
  resolveDns?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>;
}): Promise<{
  html: string;
  inputBytes: number;
  normalizedBytes: number;
  dependencies: Array<{ url: string; sha256: string; sizeBytes: number; contentType: string }>;
  transformations: Array<{ code: string; source: string; message: string }>;
  warnings: Array<{ code: string; message: string; source?: string; remediation: string }>;
}>;
export function validateManifest(manifest: unknown, options?: { allowReserved?: boolean; requireReserved?: boolean }): ArtifactManifest;
export function validateHtml(html: string, options?: { selfContained?: boolean; datasetCount?: number }): void;
export function datasetKeyFromFileName(name: string): string;
export function datasetKeysFromHtml(html: string): string[];
export function extractZip(buffer: Buffer): Promise<Map<string, Buffer>>;
export function assertSafeZipPath(name: string): void;
export function buildManifest(input: {
  slug: string;
  title: string;
  description?: string;
  kind: 'report' | 'tool';
  version?: string;
  owner: string;
  dataDate?: string;
  capabilities?: string[];
  datasets?: Array<{ key: string; schemaVersion?: number; required?: boolean; maxBytes?: number; schema?: string }>;
}): ArtifactManifest;
export function packageArtifact(input: {
  title?: string;
  description?: string;
  kind?: 'report' | 'tool';
  owner?: string;
  dataDate?: string;
  capabilities?: string[];
  slug?: string;
  version?: string;
  html?: string;
  htmlName?: string;
  zip?: Buffer;
  files?: Map<string, Buffer>;
  attachments?: Record<string, Buffer | string>;
  datasets?: Array<{ key: string; payload?: unknown; schema?: unknown }>;
  vendorFiles?: Map<string, Buffer>;
  allowReserved?: boolean;
  root?: string;
  base?: string;
  fetchRemote?: (url: string) => Promise<unknown>;
  resolveDns?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>;
}): Promise<PackagedArtifact>;
export function validateArtifactDirectory(directory: string, options?: { allowReserved?: boolean }): ArtifactManifest;
export function inlineHtmlFile(entryPath: string, targetRoot?: string): string;
