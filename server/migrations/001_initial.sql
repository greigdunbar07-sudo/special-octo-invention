CREATE TABLE PortalUser (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  tenantId nvarchar(36) NOT NULL,
  entraObjectId nvarchar(36) NULL,
  email nvarchar(320) NOT NULL,
  displayName nvarchar(200) NOT NULL,
  role nvarchar(20) NOT NULL CHECK (role IN ('viewer','admin')),
  status nvarchar(20) NOT NULL CHECK (status IN ('pending','active','disabled')),
  createdAt datetime2 NOT NULL,
  updatedAt datetime2 NOT NULL,
  CONSTRAINT UQ_PortalUser_Email UNIQUE (email)
);

CREATE TABLE AccessGroup (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  tenantId nvarchar(36) NOT NULL,
  name nvarchar(160) NOT NULL,
  description nvarchar(500) NOT NULL,
  createdAt datetime2 NOT NULL,
  updatedAt datetime2 NOT NULL,
  CONSTRAINT UQ_AccessGroup_TenantName UNIQUE (tenantId,name)
);

CREATE TABLE GroupMember (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  groupId uniqueidentifier NOT NULL REFERENCES AccessGroup(id) ON DELETE CASCADE,
  userId uniqueidentifier NOT NULL REFERENCES PortalUser(id) ON DELETE CASCADE,
  createdAt datetime2 NOT NULL,
  CONSTRAINT UQ_GroupMember UNIQUE (groupId,userId)
);

CREATE TABLE Artifact (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  slug nvarchar(100) NOT NULL UNIQUE,
  title nvarchar(200) NOT NULL,
  description nvarchar(800) NOT NULL,
  kind nvarchar(20) NOT NULL CHECK (kind IN ('report','tool')),
  version nvarchar(32) NOT NULL,
  owner nvarchar(200) NOT NULL,
  dataDate nvarchar(20) NULL,
  entryUrl nvarchar(500) NOT NULL,
  capabilitiesJson nvarchar(500) NOT NULL,
  datasetKeysJson nvarchar(1000) NOT NULL,
  isActive bit NOT NULL DEFAULT 1,
  createdAt datetime2 NOT NULL,
  updatedAt datetime2 NOT NULL
);

CREATE TABLE ArtifactGrant (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  artifactId uniqueidentifier NOT NULL REFERENCES Artifact(id) ON DELETE CASCADE,
  targetType nvarchar(20) NOT NULL CHECK (targetType IN ('user','group')),
  targetId uniqueidentifier NOT NULL,
  createdAt datetime2 NOT NULL,
  createdByUserId uniqueidentifier NOT NULL REFERENCES PortalUser(id),
  CONSTRAINT UQ_ArtifactGrant UNIQUE (artifactId,targetType,targetId)
);

CREATE TABLE Dataset (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  artifactId uniqueidentifier NOT NULL REFERENCES Artifact(id),
  datasetKey nvarchar(100) NOT NULL,
  schemaVersion int NOT NULL,
  generatedAt datetime2 NOT NULL,
  checksum nvarchar(80) NOT NULL,
  sizeBytes int NOT NULL,
  recordCount int NOT NULL,
  storageLocation nvarchar(1000) NOT NULL,
  status nvarchar(20) NOT NULL CHECK (status IN ('active','superseded')),
  createdAt datetime2 NOT NULL,
  createdByUserId uniqueidentifier NOT NULL REFERENCES PortalUser(id)
);

CREATE TABLE AuditEvent (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  tenantId nvarchar(36) NOT NULL,
  occurredAt datetime2 NOT NULL,
  actorUserId uniqueidentifier NULL REFERENCES PortalUser(id),
  actorEmail nvarchar(320) NOT NULL,
  action nvarchar(100) NOT NULL,
  subjectType nvarchar(100) NOT NULL,
  subjectLabel nvarchar(200) NOT NULL,
  detail nvarchar(2000) NOT NULL
);

CREATE INDEX IX_PortalUser_TenantObject ON PortalUser(tenantId,entraObjectId);
CREATE UNIQUE INDEX UQ_PortalUser_Object ON PortalUser(entraObjectId) WHERE entraObjectId IS NOT NULL;
CREATE INDEX IX_GroupMember_User ON GroupMember(userId,groupId);
CREATE INDEX IX_ArtifactGrant_Target ON ArtifactGrant(targetType,targetId,artifactId);
CREATE INDEX IX_Dataset_Active ON Dataset(artifactId,datasetKey,status,createdAt DESC);
CREATE UNIQUE INDEX UQ_Dataset_OneActive ON Dataset(artifactId,datasetKey) WHERE status = 'active';
CREATE INDEX IX_AuditEvent_OccurredAt ON AuditEvent(occurredAt DESC);
