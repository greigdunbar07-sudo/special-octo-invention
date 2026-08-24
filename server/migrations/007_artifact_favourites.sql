CREATE TABLE ArtifactFavorite (
  userId uniqueidentifier NOT NULL REFERENCES PortalUser(id) ON DELETE CASCADE,
  artifactId uniqueidentifier NOT NULL REFERENCES Artifact(id) ON DELETE CASCADE,
  createdAt datetime2 NOT NULL,
  CONSTRAINT PK_ArtifactFavorite PRIMARY KEY (userId,artifactId)
);

CREATE INDEX IX_ArtifactFavorite_Artifact ON ArtifactFavorite(artifactId,userId);
