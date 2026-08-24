CREATE TABLE QlikDatasetBinding (
  artifactId uniqueidentifier NOT NULL REFERENCES Artifact(id) ON DELETE CASCADE,
  datasetKey nvarchar(100) NOT NULL,
  appId nvarchar(80) NOT NULL,
  objectId nvarchar(80) NOT NULL,
  refreshHourUtc tinyint NOT NULL,
  refreshMinuteUtc tinyint NOT NULL,
  enabled bit NOT NULL CONSTRAINT DF_QlikDatasetBinding_enabled DEFAULT 1,
  lastPulledAt datetime2 NULL,
  lastError nvarchar(2000) NULL,
  lastRecordCount int NULL,
  nextDueAt datetime2 NOT NULL,
  leaseUntil datetime2 NULL,
  leaseOwner nvarchar(80) NULL,
  createdAt datetime2 NOT NULL,
  updatedAt datetime2 NOT NULL,
  CONSTRAINT PK_QlikDatasetBinding PRIMARY KEY (artifactId, datasetKey),
  CONSTRAINT CK_QlikDatasetBinding_hour CHECK (refreshHourUtc BETWEEN 0 AND 23),
  CONSTRAINT CK_QlikDatasetBinding_minute CHECK (refreshMinuteUtc BETWEEN 0 AND 59)
);

CREATE INDEX IX_QlikDatasetBinding_Due ON QlikDatasetBinding(enabled, nextDueAt, leaseUntil);
