import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('runtime database grants', () => {
  it('grants the portal role access to every user-facing preference table', () => {
    const script = readFileSync('server/grant-runtime.ts', 'utf8');
    expect(script).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ArtifactFavorite TO portal_runtime;');
    expect(script).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.QlikDatasetBinding TO portal_runtime;');
    expect(script).toContain('GRANT SELECT, INSERT, DELETE ON dbo.PortalUsageEvent TO portal_runtime;');
  });
});
