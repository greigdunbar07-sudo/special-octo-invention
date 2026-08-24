CREATE TABLE PortalUsageEvent (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  tenantId nvarchar(36) NOT NULL,
  userId uniqueidentifier NOT NULL REFERENCES PortalUser(id) ON DELETE CASCADE,
  eventType nvarchar(40) NOT NULL CHECK (eventType IN ('portal_session_started','catalog_searched','artifact_opened','artifact_ready','artifact_failed','favorite_changed')),
  sessionId uniqueidentifier NOT NULL,
  interactionId uniqueidentifier NULL,
  artifactId uniqueidentifier NULL REFERENCES Artifact(id) ON DELETE SET NULL,
  occurredAt datetime2 NOT NULL,
  receivedAt datetime2 NOT NULL CONSTRAINT DF_PortalUsageEvent_ReceivedAt DEFAULT SYSUTCDATETIME(),
  resultCount int NULL CHECK (resultCount IS NULL OR resultCount >= 0),
  kindFilter nvarchar(20) NULL CHECK (kindFilter IS NULL OR kindFilter IN ('all','report','tool')),
  filterCount tinyint NULL,
  errorCode nvarchar(80) NULL CHECK (errorCode IS NULL OR errorCode IN ('DATASET_LOAD_FAILED','ARTIFACT_REPORTED_ERROR','INITIALIZATION_TIMEOUT','FRAME_LOAD_FAILED')),
  durationMs int NULL CHECK (durationMs IS NULL OR durationMs BETWEEN 0 AND 300000),
  favoriteEnabled bit NULL
);

CREATE INDEX IX_PortalUsageEvent_TenantOccurred
  ON PortalUsageEvent(tenantId,occurredAt DESC)
  INCLUDE (eventType,userId,artifactId,resultCount,durationMs);

CREATE INDEX IX_PortalUsageEvent_UserTypeOccurred
  ON PortalUsageEvent(userId,eventType,occurredAt DESC)
  INCLUDE (artifactId);

CREATE INDEX IX_PortalUsageEvent_ArtifactOccurred
  ON PortalUsageEvent(artifactId,occurredAt DESC)
  INCLUDE (eventType,userId);

CREATE INDEX IX_PortalUsageEvent_ReadyRecent
  ON PortalUsageEvent(userId,occurredAt DESC)
  INCLUDE (artifactId)
  WHERE eventType = 'artifact_ready';
