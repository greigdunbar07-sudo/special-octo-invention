IF COL_LENGTH('dbo.Artifact', 'icon') IS NULL
  ALTER TABLE dbo.Artifact ADD icon nvarchar(40) NULL;
