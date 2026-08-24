import type { ArtifactGrant, ArtifactSummary, GroupMember, PortalIdentity } from '@/types/portal';

export function resolveCatalogForUser(user: PortalIdentity, artifacts: ArtifactSummary[], memberships: GroupMember[], grants: ArtifactGrant[]) {
  if (user.status !== 'active') return [];
  const groupIds = new Set(memberships.filter((item) => item.userId === user.id).map((item) => item.groupId));
  const artifactIds = new Set(grants.filter((grant) => (grant.targetType === 'user' && grant.targetId === user.id) || (grant.targetType === 'group' && groupIds.has(grant.targetId))).map((grant) => grant.artifactId));
  return artifacts.filter((artifact) => artifactIds.has(artifact.id));
}
