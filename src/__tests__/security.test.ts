import { describe, expect, it } from 'vitest';

import { isArtifactBridgeMessage, MAX_ARTIFACT_DOWNLOAD_BYTES } from '@/services/artifactBridge';
import { resolveCatalogForUser } from '@/services/entitlements';
import type { ArtifactGrant, ArtifactSummary, GroupMember, PortalIdentity } from '@/types/portal';
import { PortalRepository } from '../../server/repository';

const user: PortalIdentity = { id: 'u1', tenantId: 't1', entraObjectId: 'o1', email: 'user@example.com', displayName: 'User', role: 'viewer', status: 'active' };
const artifacts = [{ id: 'a1' }, { id: 'a2' }] as ArtifactSummary[];
const memberships = [{ id: 'm1', groupId: 'g1', userId: 'u1' }] as GroupMember[];

describe('catalog entitlements', () => {
  it('combines direct and group grants without duplicates', () => {
    const grants = [
      { id: 'x1', artifactId: 'a1', targetType: 'user', targetId: 'u1' },
      { id: 'x2', artifactId: 'a2', targetType: 'group', targetId: 'g1' },
      { id: 'x3', artifactId: 'a1', targetType: 'group', targetId: 'g1' },
    ] as ArtifactGrant[];
    expect(resolveCatalogForUser(user, artifacts, memberships, grants).map((item) => item.id)).toEqual(['a1', 'a2']);
  });
  it('returns nothing for disabled users', () => expect(resolveCatalogForUser({ ...user, status: 'disabled' }, artifacts, memberships, []).length).toBe(0));
  it('revokes catalog access as soon as the last grant is removed', () => {
    const direct = [{ id: 'x1', artifactId: 'a1', targetType: 'user', targetId: 'u1' }] as ArtifactGrant[];
    expect(resolveCatalogForUser(user, artifacts, memberships, direct).map((item) => item.id)).toEqual(['a1']);
    expect(resolveCatalogForUser(user, artifacts, memberships, []).map((item) => item.id)).toEqual([]);
  });
});

describe('server administrator boundary', () => {
  const repository = new PortalRepository({} as never, {} as never);
  it('denies viewers and permits an active administrator', () => {
    expect(() => repository.requireAdmin(user)).toThrow('Administrator access is required');
    expect(() => repository.requireAdmin({ ...user, role: 'admin' })).not.toThrow();
  });
});

describe('artifact bridge validation', () => {
  it('accepts versioned lifecycle messages', () => {
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'ready' })).toBe(true);
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'initialized' })).toBe(true);
  });
  it('accepts bounded Office downloads and rejects unsafe bridge payloads', () => {
    class OversizedBlob extends Blob { get size() { return MAX_ARTIFACT_DOWNLOAD_BYTES + 1; } }
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'download', filename: 'model.xlsx', blob: new Blob(['model']) })).toBe(true);
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'download', filename: 'model.exe', blob: new Blob(['model']) })).toBe(false);
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'download', filename: 'model.xlsx', blob: new Blob([]) })).toBe(false);
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'download', filename: 'model.xlsx', blob: new OversizedBlob(['model']) })).toBe(false);
  });
  it('accepts a Blob cloned from an iframe realm', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const FrameBlob = (frame.contentWindow as unknown as { Blob: typeof Blob }).Blob;
    const framedBlob = new FrameBlob(['model']);
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'download', filename: 'model.xlsx', blob: framedBlob })).toBe(true);
    frame.remove();
  });
  it('rejects malformed, unknown and future messages', () => {
    expect(isArtifactBridgeMessage(null)).toBe(false);
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 2, type: 'ready' })).toBe(false);
    expect(isArtifactBridgeMessage({ protocol: 'covetrus.portal.bridge', version: 1, type: 'navigate' })).toBe(false);
  });
});
