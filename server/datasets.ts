import { createHash, randomUUID } from 'node:crypto';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { PERMISSIVE_SCHEMA } from '../scripts/artifact-package.mjs';
import type { DatasetEnvelope, PortalIdentity, QlikDatasetBinding } from '../src/types/portal.js';
import { DEFAULT_QLIK_CLEAN_RECIPE } from '../src/types/portal.js';
import type { ArtifactManifest, ArtifactRegistry, RegisteredArtifact } from './artifacts.js';
import { AppError } from './errors.js';
import { presentQlikPayload } from './qlik-clean.js';
import {
  QLIK_CHUNK_FORMAT,
  QLIK_EXTRACT_MAX_BYTES,
  isCompactQlikPayload,
  isQlikChunkManifest,
  splitQlikRowChunks,
  type QlikChunkManifest,
  type QlikTablePayload,
} from './qlik-extract.js';
import type { PortalRepository } from './repository.js';
import { PortalStorage, safeStorageKey } from './storage.js';

const MAX_DATASET_BYTES = 10 * 1024 * 1024;

export interface DatasetDownload {
  etag: string;
  /** Null when the caller's If-None-Match already matches the stored dataset. */
  envelope: DatasetEnvelope | null;
}

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}

export class DatasetService {
  private readonly ajv = new Ajv2020({ allErrors: true });

  constructor(
    private readonly registry: ArtifactRegistry,
    private readonly repository: PortalRepository,
    private readonly storage: PortalStorage,
  ) {}

  async resolve(artifactId: string, datasetKey?: string): Promise<RegisteredArtifact> {
    const bundled = this.registry.tryByDatabaseId(artifactId);
    if (bundled) {
      if (datasetKey && !bundled.manifest.datasets.some((item) => item.key === datasetKey)) {
        throw new AppError(404, 'DATASET_NOT_DECLARED', 'The dataset is not declared by this artifact.');
      }
      return bundled;
    }
    const record = await this.repository.getArtifactById(artifactId);
    if (!record || record.summary.source !== 'uploaded' || !record.bundleLocation) {
      throw new AppError(404, 'ARTIFACT_NOT_FOUND', 'The artifact was not found.');
    }
    const manifest = JSON.parse((await this.storage.get(safeStorageKey(record.bundleLocation, 'manifest.json'))).toString('utf8')) as ArtifactManifest;
    if (datasetKey && !manifest.datasets.some((item) => item.key === datasetKey)) {
      if (!record.summary.datasetKeys.includes(datasetKey)) {
        throw new AppError(404, 'DATASET_NOT_DECLARED', 'The dataset is not declared by this artifact.');
      }
      manifest.datasets.push({ key: datasetKey, schemaVersion: 1, required: true, maxBytes: MAX_DATASET_BYTES, schema: `${datasetKey}.schema.json` });
    }
    const schemas = new Map<string, unknown>();
    for (const dataset of manifest.datasets) {
      const schemaFile = dataset.schema ?? `${dataset.key}.schema.json`;
      try {
        schemas.set(dataset.key, JSON.parse((await this.storage.get(safeStorageKey(record.bundleLocation!, schemaFile))).toString('utf8')));
      } catch {
        schemas.set(dataset.key, PERMISSIVE_SCHEMA);
      }
    }
    return { databaseId: record.summary.id, manifest, schemas, source: 'uploaded', bundleLocation: record.bundleLocation };
  }

  async upload(admin: PortalIdentity, artifactId: string, datasetKey: string, payload: unknown): Promise<void> {
    this.repository.requireAdmin(admin);
    const registered = await this.resolve(artifactId, datasetKey);
    const contract = registered.manifest.datasets.find((item) => item.key === datasetKey)!;
    const schema = registered.schemas.get(datasetKey) ?? PERMISSIVE_SCHEMA;
    const validate = this.ajv.compile(schema);
    if (!validate(payload)) throw new AppError(400, 'SCHEMA_INVALID', validate.errors?.[0]?.message ?? 'Dataset schema validation failed.');

    const payloadJson = JSON.stringify(payload);
    const payloadBytes = Buffer.from(payloadJson);
    if (isCompactQlikPayload(payload)) {
      if (payloadBytes.byteLength > QLIK_EXTRACT_MAX_BYTES) {
        throw new AppError(413, 'DATASET_TOO_LARGE', 'The Qlik extract exceeds the 50 MB assembled limit after compacting. Use a smaller table or fewer columns.');
      }
      if (payloadBytes.byteLength > Math.min(contract.maxBytes, MAX_DATASET_BYTES)) {
        await this.uploadQlikChunks(admin, registered, artifactId, datasetKey, contract.schemaVersion, payload, payloadBytes.byteLength);
        return;
      }
    } else if (payloadBytes.byteLength > Math.min(contract.maxBytes, MAX_DATASET_BYTES)) {
      throw new AppError(413, 'DATASET_TOO_LARGE', 'The dataset exceeds its declared size limit.');
    }
    const checksum = `sha256:${createHash('sha256').update(payloadBytes).digest('hex')}`;
    const generatedAt = new Date();
    const envelope: DatasetEnvelope = { artifactId: registered.manifest.id, datasetKey, schemaVersion: contract.schemaVersion, generatedAt: generatedAt.toISOString(), checksum, payload };
    const blobName = `${registered.manifest.id}/${datasetKey}/${checksum.slice(7)}.json`;
    await this.storage.put(blobName, Buffer.from(JSON.stringify(envelope)), 'application/json; charset=utf-8');
    const recordCount = Array.isArray(payload)
      ? payload.length
      : Array.isArray((payload as { rows?: unknown }).rows)
        ? (payload as { rows: unknown[] }).rows.length
        : Object.values((payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>).filter(Array.isArray).reduce((sum, value) => sum + value.length, 0);
    await this.repository.registerDataset(admin, { artifactId, datasetKey, schemaVersion: contract.schemaVersion, generatedAt, checksum, sizeBytes: payloadBytes.byteLength, recordCount, storageLocation: blobName });
  }

  async download(user: PortalIdentity, artifactId: string, datasetKey: string): Promise<DatasetEnvelope> {
    const result = await this.downloadIfChanged(user, artifactId, datasetKey);
    return result.envelope!;
  }

  async downloadIfChanged(user: PortalIdentity, artifactId: string, datasetKey: string, ifNoneMatch?: string): Promise<DatasetDownload> {
    await this.resolve(artifactId, datasetKey);
    await this.repository.canReadArtifact(user, artifactId);
    const metadata = await this.repository.activeDataset(artifactId, datasetKey);
    // The presented payload depends on both the stored bytes (checksum) and the
    // Qlik transform recipe, so the binding's updatedAt participates in the ETag.
    const binding = await this.repository.getQlikBinding(artifactId, datasetKey);
    const etag = `"${String(metadata.checksum)}${binding ? `|${binding.updatedAt}` : ''}"`;
    if (etagMatches(ifNoneMatch, etag)) return { etag, envelope: null };
    const text = (await this.storage.get(String(metadata.storageLocation))).toString('utf8');
    let envelope: DatasetEnvelope;
    try { envelope = JSON.parse(text) as DatasetEnvelope; }
    catch { throw new AppError(500, 'DATASET_CORRUPT', 'The protected dataset could not be read.'); }
    if (isQlikChunkManifest(envelope.payload)) {
      envelope.payload = this.presentQlik(binding, await this.assembleQlikChunks(envelope.payload, String(metadata.checksum)));
    } else {
      const computed = `sha256:${createHash('sha256').update(Buffer.from(JSON.stringify(envelope.payload))).digest('hex')}`;
      if (computed !== metadata.checksum || envelope.checksum !== metadata.checksum) throw new AppError(500, 'CHECKSUM_MISMATCH', 'Dataset integrity validation failed.');
      if (isCompactQlikPayload(envelope.payload)) envelope.payload = this.presentQlik(binding, envelope.payload);
    }
    return { etag, envelope };
  }

  private async uploadQlikChunks(
    admin: PortalIdentity,
    registered: RegisteredArtifact,
    artifactId: string,
    datasetKey: string,
    schemaVersion: number,
    payload: QlikTablePayload,
    sizeBytes: number,
  ): Promise<void> {
    const chunks = splitQlikRowChunks(payload.rows);
    const partPrefix = `${registered.manifest.id}/${datasetKey}/parts/${randomUUID()}`;
    const hash = createHash('sha256');
    const parts: string[] = [];
    for (const [index, rows] of chunks.entries()) {
      const location = `${partPrefix}/part-${String(index).padStart(3, '0')}.json`;
      const bytes = Buffer.from(JSON.stringify({ rows }));
      hash.update(bytes);
      await this.storage.put(location, bytes, 'application/json; charset=utf-8');
      parts.push(location);
    }
    const checksum = `sha256:${hash.digest('hex')}`;
    const manifest: QlikChunkManifest = {
      format: QLIK_CHUNK_FORMAT,
      asOf: payload.asOf,
      appId: payload.appId,
      objectId: payload.objectId,
      columns: payload.columns,
      parts,
      recordCount: payload.rows.length,
    };
    const generatedAt = new Date();
    const envelope: DatasetEnvelope = { artifactId: registered.manifest.id, datasetKey, schemaVersion, generatedAt: generatedAt.toISOString(), checksum, payload: manifest };
    const blobName = `${registered.manifest.id}/${datasetKey}/${checksum.slice(7)}.json`;
    await this.storage.put(blobName, Buffer.from(JSON.stringify(envelope)), 'application/json; charset=utf-8');
    await this.repository.registerDataset(admin, {
      artifactId, datasetKey, schemaVersion, generatedAt, checksum, sizeBytes, recordCount: payload.rows.length, storageLocation: blobName,
    });
  }

  private async assembleQlikChunks(manifest: QlikChunkManifest, expectedChecksum: string) {
    const hash = createHash('sha256');
    const rows: QlikTablePayload['rows'] = [];
    for (const part of manifest.parts) {
      const bytes = await this.storage.get(part);
      hash.update(bytes);
      let parsed: { rows?: QlikTablePayload['rows'] };
      try { parsed = JSON.parse(bytes.toString('utf8')) as { rows?: QlikTablePayload['rows'] }; }
      catch { throw new AppError(500, 'DATASET_CORRUPT', 'The protected dataset could not be read.'); }
      if (!Array.isArray(parsed.rows)) throw new AppError(500, 'DATASET_CORRUPT', 'The protected dataset could not be read.');
      rows.push(...parsed.rows);
    }
    const checksum = `sha256:${hash.digest('hex')}`;
    if (checksum !== expectedChecksum) throw new AppError(500, 'CHECKSUM_MISMATCH', 'Dataset integrity validation failed.');
    return { asOf: manifest.asOf, appId: manifest.appId, objectId: manifest.objectId, columns: manifest.columns, rows };
  }

  private presentQlik(binding: QlikDatasetBinding | null, payload: QlikTablePayload): unknown {
    return presentQlikPayload(payload, binding?.transform ?? DEFAULT_QLIK_CLEAN_RECIPE);
  }
}
