import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { v5 as uuidv5 } from 'uuid';

import { AppError } from './errors.js';

export interface DatasetContract {
  key: string;
  schemaVersion: number;
  maxBytes: number;
  required?: boolean;
  schema?: string;
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
  datasets: DatasetContract[];
}

export type ArtifactSource = 'bundled' | 'uploaded';

export interface RegisteredArtifact {
  databaseId: string;
  manifest: ArtifactManifest;
  schemas: Map<string, unknown>;
  source: ArtifactSource;
  bundleLocation?: string | null;
}

export function artifactEntryUrl(manifest: Pick<ArtifactManifest, 'id' | 'entry' | 'version'>): string {
  return `/artifacts/${manifest.id}/${manifest.entry}?v=${encodeURIComponent(manifest.version)}`;
}

export function artifactDatabaseId(slug: string): string {
  return uuidv5(`covetrus-portal:${slug}`, uuidv5.URL);
}

function loadDirectory(directory: string): RegisteredArtifact {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')) as ArtifactManifest;
  const schemas = new Map<string, unknown>();
  for (const dataset of manifest.datasets) {
    const schemaFile = dataset.schema ?? `${dataset.key}.schema.json`;
    schemas.set(dataset.key, JSON.parse(readFileSync(resolve(directory, schemaFile), 'utf8')));
  }
  return {
    databaseId: artifactDatabaseId(manifest.id),
    manifest,
    schemas,
    source: 'bundled',
    bundleLocation: null,
  };
}

export class ArtifactRegistry {
  readonly entries: RegisteredArtifact[];

  constructor(root: string) {
    const artifactRoot = resolve(root);
    this.entries = existsSync(artifactRoot)
      ? readdirSync(artifactRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && existsSync(resolve(artifactRoot, entry.name, 'manifest.json')))
        .map((entry) => loadDirectory(resolve(artifactRoot, entry.name)))
      : [];
  }

  tryByDatabaseId(databaseId: string): RegisteredArtifact | undefined {
    const normalizedId = databaseId.trim().toLowerCase();
    return this.entries.find((entry) => entry.databaseId.toLowerCase() === normalizedId);
  }

  tryBySlug(slug: string): RegisteredArtifact | undefined {
    return this.entries.find((entry) => entry.manifest.id === slug);
  }

  byDatabaseId(databaseId: string, datasetKey?: string): RegisteredArtifact {
    const artifact = this.tryByDatabaseId(databaseId);
    if (!artifact) throw new AppError(404, 'ARTIFACT_NOT_FOUND', 'The artifact was not found.');
    if (datasetKey && !artifact.manifest.datasets.some((item) => item.key === datasetKey)) {
      throw new AppError(404, 'DATASET_NOT_DECLARED', 'The dataset is not declared by this artifact.');
    }
    return artifact;
  }

  bySlug(slug: string): RegisteredArtifact {
    const artifact = this.tryBySlug(slug);
    if (!artifact) throw new AppError(404, 'ARTIFACT_NOT_FOUND', 'The artifact was not found.');
    return artifact;
  }
}
