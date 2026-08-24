import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import sql from 'mssql';

import type { AppConfig } from './config.js';

export const azureCredential = new DefaultAzureCredential();

let poolState: { pool: sql.ConnectionPool; expiresOn: number } | null = null;

export async function getSqlPool(config: AppConfig): Promise<sql.ConnectionPool> {
  if (poolState && poolState.expiresOn - Date.now() > 5 * 60_000 && poolState.pool.connected) {
    return poolState.pool;
  }
  if (poolState) {
    await poolState.pool.close().catch(() => undefined);
    poolState = null;
  }
  const accessToken = process.env.AZURE_SQL_ACCESS_TOKEN
    ? { token: process.env.AZURE_SQL_ACCESS_TOKEN, expiresOnTimestamp: Date.now() + 30 * 60_000 }
    : await azureCredential.getToken('https://database.windows.net/.default');
  if (!accessToken) throw new Error('Azure SQL access token acquisition failed.');

  const pool = await new sql.ConnectionPool({
    server: config.sqlServer,
    database: config.sqlDatabase,
    port: 1433,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: accessToken.token },
    },
    // min 1 keeps a warm connection so requests after idle periods skip the TLS/login handshake.
    pool: { min: 1, max: 10, idleTimeoutMillis: 30_000 },
  }).connect();
  poolState = { pool, expiresOn: accessToken.expiresOnTimestamp };
  return pool;
}

export function getBlobContainer(config: AppConfig): ContainerClient {
  const service = new BlobServiceClient(
    `https://${config.storageAccount}.blob.core.windows.net`,
    azureCredential,
  );
  return service.getContainerClient(config.storageContainer);
}

export async function closeAzureConnections(): Promise<void> {
  if (poolState) await poolState.pool.close().catch(() => undefined);
  poolState = null;
}
