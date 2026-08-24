import { closeAzureConnections, getSqlPool } from './azure.js';
import { loadConfig } from './config.js';

const identityName = process.env.APP_SERVICE_IDENTITY_NAME?.trim();
if (!identityName || !/^[A-Za-z0-9-]{1,60}$/.test(identityName)) throw new Error('APP_SERVICE_IDENTITY_NAME must contain only letters, numbers, and hyphens.');
const clientId = process.env.APP_SERVICE_CLIENT_ID?.trim();
if (!clientId || !/^[0-9a-fA-F-]{36}$/.test(clientId)) throw new Error('APP_SERVICE_CLIENT_ID must be the managed identity application/client GUID.');
const quoted = `[${identityName.replaceAll(']', ']]')}]`;
const pool = await getSqlPool(loadConfig(false));
await pool.request().batch(`
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'${identityName}')
BEGIN
  DECLARE @clientId uniqueidentifier = '${clientId}';
  DECLARE @sid nvarchar(34) = CONVERT(varchar(max), CONVERT(varbinary(16), @clientId), 1);
  EXEC(N'CREATE USER ${quoted} WITH SID = ' + @sid + N', TYPE = E');
END;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name=N'portal_runtime' AND type='R') CREATE ROLE portal_runtime AUTHORIZATION dbo;
IF EXISTS (SELECT 1 FROM sys.database_role_members drm JOIN sys.database_principals r ON r.principal_id=drm.role_principal_id JOIN sys.database_principals m ON m.principal_id=drm.member_principal_id WHERE r.name='db_datareader' AND m.name=N'${identityName}') ALTER ROLE db_datareader DROP MEMBER ${quoted};
IF EXISTS (SELECT 1 FROM sys.database_role_members drm JOIN sys.database_principals r ON r.principal_id=drm.role_principal_id JOIN sys.database_principals m ON m.principal_id=drm.member_principal_id WHERE r.name='db_datawriter' AND m.name=N'${identityName}') ALTER ROLE db_datawriter DROP MEMBER ${quoted};
IF NOT EXISTS (SELECT 1 FROM sys.database_role_members drm JOIN sys.database_principals r ON r.principal_id=drm.role_principal_id JOIN sys.database_principals m ON m.principal_id=drm.member_principal_id WHERE r.name='portal_runtime' AND m.name=N'${identityName}') ALTER ROLE portal_runtime ADD MEMBER ${quoted};
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.PortalUser TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.AccessGroup TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.GroupMember TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Artifact TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ArtifactGrant TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ArtifactFavorite TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Dataset TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.QlikDatasetBinding TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.PortalNotification TO portal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.AccessRequest TO portal_runtime;
GRANT SELECT, INSERT, DELETE ON dbo.PortalUsageEvent TO portal_runtime;
GRANT SELECT, INSERT ON dbo.AuditEvent TO portal_runtime;
`);
console.log(`Granted least-privilege runtime database access to ${identityName}.`);
await closeAzureConnections();
