-- Generalise PortalNotification from a dataset-refresh feed into a typed event
-- feed. Admin events (access requests, joins) carry no artifact or dataset, so
-- both columns become nullable and per-dataset uniqueness moves to a filtered
-- index.
DROP INDEX IX_PortalNotification_UserCreated ON PortalNotification;
ALTER TABLE PortalNotification DROP CONSTRAINT UQ_PortalNotification_UserDataset;
ALTER TABLE PortalNotification ALTER COLUMN artifactId uniqueidentifier NULL;
ALTER TABLE PortalNotification ALTER COLUMN datasetId uniqueidentifier NULL;
ALTER TABLE PortalNotification ADD [type] nvarchar(40) NOT NULL CONSTRAINT DF_PortalNotification_Type DEFAULT 'dataset_refreshed';
ALTER TABLE PortalNotification ADD subjectLabel nvarchar(200) NULL;
GO
CREATE INDEX IX_PortalNotification_UserCreated
  ON PortalNotification(userId,createdAt DESC)
  INCLUDE (readAt,artifactId,datasetId,[type]);
CREATE UNIQUE INDEX UQ_PortalNotification_UserDataset
  ON PortalNotification(userId,datasetId)
  WHERE datasetId IS NOT NULL;
