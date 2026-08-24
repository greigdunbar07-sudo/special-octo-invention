DECLARE @constraintName sysname;
SELECT TOP 1 @constraintName = fk.name
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables parentTable ON parentTable.object_id = fk.parent_object_id
JOIN sys.columns parentColumn ON parentColumn.object_id = fkc.parent_object_id AND parentColumn.column_id = fkc.parent_column_id
JOIN sys.tables referencedTable ON referencedTable.object_id = fk.referenced_object_id
WHERE parentTable.name = 'AuditEvent'
  AND parentColumn.name = 'actorUserId'
  AND referencedTable.name = 'PortalUser';

IF @constraintName IS NOT NULL
BEGIN
  DECLARE @dropConstraintSql nvarchar(max);
  SET @dropConstraintSql = N'ALTER TABLE dbo.AuditEvent DROP CONSTRAINT ' + QUOTENAME(@constraintName);
  EXEC sys.sp_executesql @dropConstraintSql;
END;

ALTER TABLE dbo.AuditEvent
  ADD CONSTRAINT FK_AuditEvent_Actor
  FOREIGN KEY (actorUserId) REFERENCES dbo.PortalUser(id) ON DELETE SET NULL;
