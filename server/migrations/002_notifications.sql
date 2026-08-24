CREATE TABLE PortalNotification (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  tenantId nvarchar(36) NOT NULL,
  userId uniqueidentifier NOT NULL REFERENCES PortalUser(id) ON DELETE CASCADE,
  artifactId uniqueidentifier NOT NULL REFERENCES Artifact(id),
  datasetId uniqueidentifier NOT NULL REFERENCES Dataset(id),
  createdAt datetime2 NOT NULL,
  readAt datetime2 NULL,
  CONSTRAINT UQ_PortalNotification_UserDataset UNIQUE (userId,datasetId)
);

CREATE INDEX IX_PortalNotification_UserCreated
  ON PortalNotification(userId,createdAt DESC)
  INCLUDE (readAt,artifactId,datasetId);
