declare module '../scripts/artifact-package.mjs' {
  export class PackageError extends Error {
    code: string;
    source?: string;
    issues: Array<{ code: string; message: string; source?: string; remediation: string }>;
    constructor(message: string, code?: string, source?: string);
  }
  export const ARTIFACT_HTML_CSP: string;
  export const MAX_ZIP_BYTES: number;
  export const PERMISSIVE_SCHEMA: { type: string[] };
  export function bumpVersion(version: string): string;
  export function slugify(value: string): string;
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
    zip?: Buffer;
    attachments?: Record<string, Buffer | string>;
    root?: string;
  }): Promise<{
    manifest: {
      id: string;
      title: string;
      description?: string;
      kind: 'report' | 'tool';
      version: string;
      owner: string;
      dataDate?: string;
      capabilities: string[];
      datasets: Array<{ key: string }>;
    };
    files: Record<string, string>;
    datasets: Array<{ key: string; payload: unknown }>;
    mode: 'self-contained' | 'data-separated';
    compatibility: {
      inputBytes: number;
      normalizedBytes: number;
      dependencies: Array<{ url: string; sha256: string; sizeBytes: number; contentType: string }>;
      transformations: Array<{ code: string; source: string; message: string }>;
      warnings: Array<{ code: string; message: string; source?: string; remediation: string }>;
    };
  }>;
}
