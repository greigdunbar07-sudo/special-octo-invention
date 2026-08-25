ALTER TABLE Artifact DROP CONSTRAINT CK_Artifact_source;
ALTER TABLE Artifact ADD CONSTRAINT CK_Artifact_source CHECK ([source] IN ('bundled','uploaded','linked'));
