import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import sql from 'mssql';

import { getSqlPool, closeAzureConnections } from './azure.js';
import { loadConfig } from './config.js';

const config = loadConfig(false);
const pool = await getSqlPool(config);
await pool.request().query(`IF OBJECT_ID('dbo.SchemaMigration','U') IS NULL
  CREATE TABLE dbo.SchemaMigration (name nvarchar(200) NOT NULL PRIMARY KEY, appliedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME())`);

const migrationRoot = resolve(process.env.MIGRATION_ROOT ?? 'server/migrations');
for (const name of readdirSync(migrationRoot).filter((file) => file.endsWith('.sql')).sort()) {
  const applied = await pool.request().input('name', name).query('SELECT name FROM dbo.SchemaMigration WHERE name=@name');
  if (applied.recordset.length) continue;
  const transaction = new sql.Transaction(pool); await transaction.begin();
  try {
    for (const batch of readFileSync(resolve(migrationRoot, name), 'utf8').split(/^\s*GO\s*$/gim).filter((item) => item.trim())) {
      await new sql.Request(transaction).batch(batch);
    }
    await new sql.Request(transaction).input('name', name).query('INSERT INTO dbo.SchemaMigration (name) VALUES (@name)');
    await transaction.commit(); console.log(`Applied ${name}`);
  } catch (error) { await transaction.rollback(); throw error; }
}
await closeAzureConnections();
