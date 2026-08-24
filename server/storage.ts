import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';

import type { AppConfig } from './config.js';
import { getBlobContainer } from './azure.js';
import { AppError } from './errors.js';

export function contentTypeFor(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'text/html; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

export function safeStorageKey(prefix: string, file: string): string {
  const relative = file.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative || relative.includes('..') || relative.startsWith('/') || /[^a-zA-Z0-9._/-]/.test(relative)) {
    throw new AppError(400, 'INVALID_BUNDLE_PATH', 'The artifact file path is invalid.');
  }
  return `${prefix.replace(/\/+$/, '')}/${relative}`;
}

export class PortalStorage {
  constructor(private readonly config: AppConfig) {}

  private diskPath(key: string): string {
    const root = resolve(this.config.bundleRoot);
    const path = resolve(root, key);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new AppError(400, 'INVALID_BUNDLE_PATH', 'The artifact file path is invalid.');
    return path;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    if (this.config.storageAccount) {
      await getBlobContainer(this.config).getBlockBlobClient(key).uploadData(data, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
      return;
    }
    const path = this.diskPath(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }

  async get(key: string): Promise<Buffer> {
    if (this.config.storageAccount) {
      const response = await getBlobContainer(this.config).getBlobClient(key).download();
      if (!response.readableStreamBody) throw new AppError(404, 'BUNDLE_MISSING', 'The published artifact file was not found.');
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    try {
      return readFileSync(this.diskPath(key));
    } catch {
      throw new AppError(404, 'BUNDLE_MISSING', 'The published artifact file was not found.');
    }
  }

  async stream(key: string): Promise<NodeJS.ReadableStream> {
    if (this.config.storageAccount) {
      const response = await getBlobContainer(this.config).getBlobClient(key).download();
      if (!response.readableStreamBody) throw new AppError(404, 'BUNDLE_MISSING', 'The published artifact file was not found.');
      return response.readableStreamBody;
    }
    const path = this.diskPath(key);
    if (!existsSync(path)) throw new AppError(404, 'BUNDLE_MISSING', 'The published artifact file was not found.');
    return createReadStream(path);
  }

  async take(key: string): Promise<Buffer> {
    if (this.config.storageAccount) {
      const client = getBlobContainer(this.config).getBlockBlobClient(key);
      try {
        const response = await client.download();
        if (!response.readableStreamBody) throw new Error('The staged package is empty.');
        const chunks: Buffer[] = [];
        for await (const chunk of response.readableStreamBody) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        await client.delete({ conditions: { ifMatch: response.etag } });
        return Buffer.concat(chunks);
      } catch {
        throw new AppError(404, 'BUNDLE_MISSING', 'The staged artifact package was not found.');
      }
    }
    const path = this.diskPath(key);
    const claimed = `${path}.claimed-${process.pid}-${Date.now()}`;
    try {
      renameSync(path, claimed);
      return readFileSync(claimed);
    } catch {
      throw new AppError(404, 'BUNDLE_MISSING', 'The staged artifact package was not found.');
    } finally {
      rmSync(claimed, { force: true });
    }
  }

  async delete(key: string): Promise<void> {
    if (this.config.storageAccount) {
      await getBlobContainer(this.config).getBlockBlobClient(key).deleteIfExists();
      return;
    }
    rmSync(this.diskPath(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    const normalized = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized.includes('..') || /[^a-zA-Z0-9._/-]/.test(normalized)) {
      throw new AppError(400, 'INVALID_BUNDLE_PATH', 'The artifact storage prefix is invalid.');
    }
    if (this.config.storageAccount) {
      const container = getBlobContainer(this.config);
      for await (const blob of container.listBlobsFlat({ prefix: `${normalized}/` })) {
        await container.getBlockBlobClient(blob.name).deleteIfExists();
      }
      return;
    }
    rmSync(this.diskPath(normalized), { recursive: true, force: true });
  }
}
