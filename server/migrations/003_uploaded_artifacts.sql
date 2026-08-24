ALTER TABLE Artifact ADD [source] nvarchar(20) NOT NULL CONSTRAINT DF_Artifact_source DEFAULT 'bundled';
GO
ALTER TABLE Artifact ADD bundleLocation nvarchar(1000) NULL;
GO
ALTER TABLE Artifact ADD CONSTRAINT CK_Artifact_source CHECK ([source] IN ('bundled','uploaded'));
