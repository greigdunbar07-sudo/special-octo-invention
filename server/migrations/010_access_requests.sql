CREATE TABLE AccessRequest (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  tenantId nvarchar(36) NOT NULL,
  entraObjectId nvarchar(36) NOT NULL,
  email nvarchar(320) NOT NULL,
  displayName nvarchar(200) NOT NULL,
  note nvarchar(500) NOT NULL,
  status nvarchar(20) NOT NULL CHECK (status IN ('requested','approved','dismissed')),
  createdAt datetime2 NOT NULL,
  updatedAt datetime2 NOT NULL,
  resolvedByUserId uniqueidentifier NULL REFERENCES PortalUser(id),
  CONSTRAINT UQ_AccessRequest_Principal UNIQUE (tenantId,entraObjectId)
);

CREATE INDEX IX_AccessRequest_Status ON AccessRequest(status,createdAt DESC);
