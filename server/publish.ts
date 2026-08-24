import crypto from 'node:crypto';

import { artifactEntryUrl, type ArtifactRegistry } from './artifacts.js';
import { AppError } from './errors.js';
import type { DatasetService } from './datasets.js';
import type { PortalRepository } from './repository.js';
import { PortalStorage, contentTypeFor, safeStorageKey } from './storage.js';
import {
  MAX_ZIP_BYTES,
  PackageError,
  bumpVersion,
  packageArtifact,
  slugify,
} from '../scripts/artifact-package.mjs';
import { parseArtifactIcon, type ArtifactKind, type ArtifactSummary, type PortalIdentity } from '../src/types/portal.js';

export interface PublishFields {
  title?: string;
  description?: string;
  kind?: string;
  owner?: string;
  dataDate?: string;
  slug?: string;
  capabilities?: string[];
  icon?: string;
  preflightToken?: string;
}

export interface PublishFiles {
  html?: Buffer;
  zip?: Buffer;
  json?: Array<{ name: string; bytes: Buffer }>;
}

interface PreparedManifest {
  id: string;
  title: string;
  description?: string;
  kind: ArtifactKind;
  version: string;
  entry: string;
  owner: string;
  dataDate?: string;
  capabilities: string[];
  icon?: ArtifactSummary['icon'];
  datasets: Array<{ key: string }>;
  [key: string]: unknown;
}

export class ArtifactPublishService {
  constructor(
    private readonly registry: ArtifactRegistry,
    private readonly repository: PortalRepository,
    private readonly datasets: DatasetService,
    private readonly storage: PortalStorage,
  ) {}

  async preflight(admin: PortalIdentity, files: PublishFiles) {
    this.repository.requireAdmin(admin);
    const primaryBytes = files.html ?? files.zip;
    const inputBytes = (primaryBytes?.byteLength ?? 0) + (files.json ?? []).reduce((total, file) => total + file.bytes.byteLength, 0);
    if (!primaryBytes) return blockedReport(inputBytes, new PackageError('Upload an HTML file or a zip package.', 'ARTIFACT_FILE_REQUIRED'));
    try {
      const token = crypto.randomUUID();
      const packaged = await packageArtifact({
        title: 'Compatibility preview', description: '', kind: 'report', owner: admin.displayName,
        slug: `preflight-${token}`, version: '0.0.0', html: files.html?.toString('utf8'), zip: files.zip,
        attachments: attachmentsFrom(files), root: process.cwd(),
      });
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      const stage = { ownerId: admin.id, tenantId: admin.tenantId, expiresAt, files: packaged.files, datasets: packaged.datasets, compatibility: packaged.compatibility };
      await this.storage.put(stageKey(admin, token), Buffer.from(JSON.stringify(stage)), 'application/json; charset=utf-8');
      return {
        status: 'ready' as const, preflightToken: token, expiresAt,
        previewUrl: `/api/admin/artifacts/preflight/${encodeURIComponent(token)}/preview`,
        inputBytes, normalizedBytes: packaged.compatibility?.normalizedBytes ?? Buffer.byteLength(packaged.files['index.html'] ?? ''),
        dependencies: packaged.compatibility?.dependencies ?? [], transformations: packaged.compatibility?.transformations ?? [],
        warnings: packaged.compatibility?.warnings ?? [], blockers: [],
      };
    } catch (error) {
      if (isPackageError(error)) {
        console.warn(JSON.stringify({ event: 'artifact.preflight.blocked', administratorId: admin.id, codes: (error.issues ?? []).map((item: { code: string }) => item.code) }));
        return blockedReport(inputBytes, error);
      }
      throw error;
    }
  }

  async preview(admin: PortalIdentity, token: string): Promise<Buffer> {
    const stage = await this.readStage(admin, token, false);
    return Buffer.from(String(stage.files['index.html'] ?? ''));
  }

  async publish(admin: PortalIdentity, fields: PublishFields, files: PublishFiles): Promise<ArtifactSummary> {
    this.repository.requireAdmin(admin);
    if (!files.html && !files.zip && !fields.preflightToken) throw new AppError(400, 'ARTIFACT_FILE_REQUIRED', 'Upload an HTML file or a zip package.');
    const title = String(fields.title ?? '').trim();
    const owner = String(fields.owner ?? '').trim();
    const kind = fields.kind === 'tool' ? 'tool' : fields.kind === 'report' ? 'report' : '';
    if (!title || !owner || !kind) throw new AppError(400, 'INVALID_ARTIFACT', 'Title, owner, and kind are required.');
    const slug = fields.slug?.trim() || slugify(title);
    if (this.registry.tryBySlug(slug)) throw new AppError(409, 'SLUG_RESERVED', 'That slug already ships in the container. Choose a different title.');
    const existing = await this.repository.getArtifactBySlug(slug);
    const version = existing?.summary.source === 'uploaded' ? bumpVersion(existing.summary.version) : '1.0.0';
    if (fields.preflightToken) {
      const stage = await this.readStage(admin, fields.preflightToken, true);
      const manifest = JSON.parse(String(stage.files['manifest.json'])) as PreparedManifest;
      Object.assign(manifest, { id: slug, title, description: String(fields.description ?? '').trim(), kind, owner, version, entry: 'index.html', capabilities: fields.capabilities ?? [], icon: validIcon(fields.icon) });
      if (fields.dataDate?.trim()) manifest.dataDate = fields.dataDate.trim(); else delete manifest.dataDate;
      stage.files['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
      return this.persist(admin, { manifest, files: stage.files, datasets: stage.datasets });
    }
    return this.store(admin, {
      title,
      description: String(fields.description ?? '').trim(),
      kind,
      owner,
      dataDate: fields.dataDate?.trim() || undefined,
      slug,
      version,
      capabilities: fields.capabilities ?? [],
      icon: validIcon(fields.icon),
      html: files.html?.toString('utf8'),
      zip: files.zip,
      json: files.json,
    });
  }

  private async readStage(admin: PortalIdentity, token: string, consume: boolean): Promise<{ ownerId: string; tenantId: string; expiresAt: string; files: Record<string, string>; datasets: Array<{ key: string; payload: unknown }> }> {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new AppError(400, 'PREFLIGHT_INVALID', 'Run compatibility checking again before publishing.');
    let bytes: Buffer;
    try { bytes = consume ? await this.storage.take(stageKey(admin, token)) : await this.storage.get(stageKey(admin, token)); }
    catch { throw new AppError(410, 'PREFLIGHT_EXPIRED', 'The compatibility check has expired. Run it again before publishing.'); }
    const stage = JSON.parse(bytes.toString('utf8')) as { ownerId: string; tenantId: string; expiresAt: string; files: Record<string, string>; datasets: Array<{ key: string; payload: unknown }> };
    if (stage.ownerId !== admin.id || stage.tenantId !== admin.tenantId) throw new AppError(403, 'PREFLIGHT_DENIED', 'This compatibility check belongs to another administrator.');
    if (Date.parse(stage.expiresAt) <= Date.now()) {
      await this.storage.delete(stageKey(admin, token));
      throw new AppError(410, 'PREFLIGHT_EXPIRED', 'The compatibility check has expired. Run it again before publishing.');
    }
    return stage;
  }

  async replaceBundle(admin: PortalIdentity, artifactId: string, files: PublishFiles): Promise<ArtifactSummary> {
    this.repository.requireAdmin(admin);
    const existing = await this.repository.getArtifactById(artifactId);
    if (!existing || existing.summary.source !== 'uploaded') throw new AppError(404, 'ARTIFACT_NOT_FOUND', 'The published artifact was not found.');
    if (!files.html && !files.zip) throw new AppError(400, 'ARTIFACT_FILE_REQUIRED', 'Upload an HTML file or a zip package.');
    return this.store(admin, {
      title: existing.summary.title,
      description: existing.summary.description,
      kind: existing.summary.kind as ArtifactKind,
      owner: existing.summary.owner,
      dataDate: existing.summary.dataDate ?? undefined,
      slug: existing.summary.slug,
      version: bumpVersion(existing.summary.version),
      capabilities: existing.summary.capabilities,
      html: files.html?.toString('utf8'),
      zip: files.zip,
      json: files.json,
      datasets: existing.summary.datasetKeys.map((key) => ({ key })),
    });
  }

  async delete(admin: PortalIdentity, artifactId: string): Promise<void> {
    const deleted = await this.repository.deleteUploadedArtifact(admin, artifactId);
    await Promise.all([
      this.storage.deletePrefix(`bundles/${deleted.slug}`),
      ...deleted.storageLocations.map((location) => this.storage.delete(location)),
    ]);
  }

  private async store(admin: PortalIdentity, input: {
    title: string; description: string; kind: ArtifactKind; owner: string; dataDate?: string; slug: string; version: string;
    capabilities: string[]; icon?: ArtifactSummary['icon']; html?: string; zip?: Buffer; json?: Array<{ name: string; bytes: Buffer }>;
    datasets?: Array<{ key: string; payload?: unknown; schema?: unknown }>;
  }): Promise<ArtifactSummary> {
    if (input.zip && input.zip.byteLength > MAX_ZIP_BYTES) throw new AppError(413, 'ARTIFACT_TOO_LARGE', 'The zip file exceeds the 15 MB limit.');
    try {
      const attachments: Record<string, Buffer> = {};
      for (const file of input.json ?? []) attachments[file.name] = file.bytes;
      const packaged = await packageArtifact({
        title: input.title,
        description: input.description,
        kind: input.kind,
        owner: input.owner,
        dataDate: input.dataDate,
        slug: input.slug,
        version: input.version,
        capabilities: input.capabilities,
        icon: input.icon,
        html: input.html,
        zip: input.zip,
        attachments,
        datasets: input.datasets,
        root: process.cwd(),
      });
      if (input.icon) packaged.manifest.icon = input.icon;
      return this.persist(admin, packaged);
    } catch (error: unknown) {
      if (isPackageError(error)) throw new AppError(400, error.code || 'ARTIFACT_INVALID', error.message);
      throw error;
    }
  }

  private async persist(admin: PortalIdentity, packaged: { manifest: PreparedManifest; files: Record<string, string>; datasets: Array<{ key: string; payload: unknown }> }): Promise<ArtifactSummary> {
    try {
      const prefix = `bundles/${packaged.manifest.id}/${packaged.manifest.version}`;
      for (const [name, content] of Object.entries(packaged.files)) {
        await this.storage.put(safeStorageKey(prefix, name), Buffer.from(String(content)), contentTypeFor(name));
      }
      const summary = await this.repository.upsertUploadedArtifact(admin, {
        slug: packaged.manifest.id,
        title: packaged.manifest.title,
        description: packaged.manifest.description ?? '',
        kind: packaged.manifest.kind,
        version: packaged.manifest.version,
        owner: packaged.manifest.owner,
        dataDate: packaged.manifest.dataDate ?? null,
        entryUrl: artifactEntryUrl(packaged.manifest),
        capabilities: packaged.manifest.capabilities,
        icon: packaged.manifest.icon,
        datasetKeys: packaged.manifest.datasets.map((dataset) => dataset.key),
        bundleLocation: prefix,
      });
      for (const dataset of packaged.datasets) {
        await this.datasets.upload(admin, summary.id, dataset.key, dataset.payload);
      }
      return summary;
    } catch (error) {
      console.error(JSON.stringify({ event: 'artifact.publish.failed', administratorId: admin.id, artifactSlug: packaged.manifest.id }));
      throw error;
    }
  }
}

function validIcon(value: unknown): ArtifactSummary['icon'] | undefined {
  return parseArtifactIcon(value);
}

function attachmentsFrom(files: PublishFiles): Record<string, Buffer> {
  return Object.fromEntries((files.json ?? []).map((file) => [file.name, file.bytes]));
}

function stageKey(admin: PortalIdentity, token: string): string {
  return `staging/${admin.tenantId}/${admin.id}/${token}.json`;
}

function isPackageError(error: unknown): error is PackageError & { code?: string; issues?: Array<{ code: string; message: string; source?: string; remediation: string }> } {
  return error instanceof Error && (error.name === 'PackageError' || error instanceof PackageError);
}

function blockedReport(inputBytes: number, error: PackageError & { code?: string; issues?: Array<{ code: string; message: string; source?: string; remediation: string }> }) {
  return {
    status: 'blocked' as const, inputBytes, normalizedBytes: 0, dependencies: [], transformations: [], warnings: [],
    blockers: error.issues ?? [{ code: error.code ?? 'ARTIFACT_INVALID', message: error.message, source: error.source, remediation: 'Update the HTML package and run compatibility checking again.' }],
  };
}
