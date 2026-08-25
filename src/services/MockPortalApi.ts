import type {
  AccessRequestRecord,
  AdminSnapshot,
  ArtifactGrant,
  ArtifactSummary,
  DatasetEnvelope,
  GroupMember,
  InviteDelivery,
  NotificationFeed,
  PortalApi,
  PortalGroup,
  PortalIdentity,
  PortalRole,
  QlikAppSummary,
  QlikBindingInput,
  QlikDatasetBinding,
  QlikPreviewSample,
  QlikTableSummary,
  ServerUsageEventType,
  UsageEventInput,
  UsageInsights,
  UsageInsightsRange,
  UserStatus,
} from '@/types/portal';
import { downloadInviteFile } from '@/lib/invite-download';
import { parseLinkedAppUrl } from '@/lib/linked-url';
import { prepareInviteFile } from '@/lib/invite-email';
import { applyQlikClean } from '@/lib/qlik-transform';
import type { QlikTablePayload } from '@/lib/qlik-payload';
import { resolveCatalogForUser } from './entitlements';

const now = '2026-08-19T09:00:00Z';

let artifacts: ArtifactSummary[] = [];

let users: PortalIdentity[] = [
  { id: '11111111-1111-4111-8111-111111111111', tenantId: 'local-development', entraObjectId: 'local-admin', email: 'dev@contoso.com', displayName: 'Greig Dunbar', role: 'admin', status: 'active', hasCompletedTour: false },
  { id: '22222222-2222-4222-8222-222222222222', tenantId: 'local-development', entraObjectId: null, email: 'alex.morgan@covetrus.com', displayName: 'Alex Morgan', role: 'viewer', status: 'pending' },
  { id: '33333333-3333-4333-8333-333333333333', tenantId: 'local-development', entraObjectId: 'entra-333', email: 'sam.taylor@covetrus.com', displayName: 'Sam Taylor', role: 'viewer', status: 'active' },
];
let groups: PortalGroup[] = [
  { id: '44444444-4444-4444-8444-444444444444', name: 'Operations leadership', description: 'Operational reports and performance views', memberCount: 2 },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Commercial finance', description: 'Pricing and opportunity modelling tools', memberCount: 0 },
];
let memberships: GroupMember[] = [
  { id: '66666666-6666-4666-8666-666666666666', groupId: groups[0].id, userId: users[2].id },
  { id: '66666666-6666-4666-8666-666666666667', groupId: groups[0].id, userId: users[0].id },
];
let grants: ArtifactGrant[] = [];
let audit = [
  { id: crypto.randomUUID(), occurredAt: now, actorEmail: 'dev@contoso.com', action: 'portal.initialised', subjectType: 'portal', subjectLabel: 'Launchpad', detail: 'Local development fixture loaded' },
];
let notifications: NotificationFeed['items'] = [];
let favoriteArtifactIds = new Set<string>();
let qlikBindings: QlikDatasetBinding[] = [];
let accessRequests: AccessRequestRecord[] = [
  { id: '77777777-7777-4777-8777-777777777777', email: 'jamie.lee@covetrus.com', displayName: 'Jamie Lee', note: 'I need the damages reports for the Monday operations call.', status: 'requested', createdAt: now, updatedAt: now },
];
type MockUsageEvent = Omit<UsageEventInput, 'eventType'> & { eventType: UsageEventInput['eventType'] | ServerUsageEventType; userId: string; favoriteEnabled?: boolean };
let usageEvents: MockUsageEvent[] = [];

const MOCK_QLIK_APP_ID = '1df4cf94-0a3b-4246-848e-40200247bfba';
const mockQlikApps: QlikAppSummary[] = [
  { id: MOCK_QLIK_APP_ID, name: 'COSI', description: 'Commercial operations source app', updatedAt: '2026-08-21T07:18:00.000Z' },
  { id: 'd51760fc-8121-4222-b1cf-e3ae6345178a', name: 'Damages', description: 'Warehouse damages analysis', updatedAt: '2026-08-20T09:00:00.000Z' },
];
const mockQlikTables: Record<string, QlikTableSummary[]> = {
  [MOCK_QLIK_APP_ID]: [
    { objectId: 'WuPA', title: 'Supplier sales', sheetTitle: 'Commercial', qType: 'table', columns: ['Supplier Name', 'Sales', 'Orders'], rowCount: 4 },
    { objectId: 'e5c80ad6-3d3a-499c-afc7-d60eb9c4f27b', title: 'Product list', sheetTitle: 'Catalogue', qType: 'table', columns: ['Product', 'List Price', 'Cost Price'], rowCount: 3 },
  ],
  'd51760fc-8121-4222-b1cf-e3ae6345178a': [
    { objectId: 'NEZnpqm', title: 'Damages by SKU', sheetTitle: 'Overview', qType: 'table', columns: ['Product', 'Units'], rowCount: 2 },
  ],
};
const mockQlikSamples: Record<string, QlikTablePayload> = {
  WuPA: {
    asOf: now, appId: MOCK_QLIK_APP_ID, objectId: 'WuPA',
    columns: [
      { key: 'supplier-name', title: 'Supplier Name', role: 'dimension' },
      { key: 'sales', title: 'Sales', role: 'measure' },
      { key: 'orders', title: 'Orders', role: 'measure' },
    ],
    rows: [['CROWN PET FOODS LIMITED', 143943.21, 18], ['SUPREME', 3.15, 1], ['', null, null], ['APOQUEL PARTNER', 40, 2]],
  },
  'e5c80ad6-3d3a-499c-afc7-d60eb9c4f27b': {
    asOf: now, appId: MOCK_QLIK_APP_ID, objectId: 'e5c80ad6-3d3a-499c-afc7-d60eb9c4f27b',
    columns: [
      { key: 'product', title: 'Product', role: 'dimension' },
      { key: 'list-price', title: 'List Price', role: 'measure' },
      { key: 'cost-price', title: 'Cost Price', role: 'measure' },
    ],
    rows: [['Apoquel', 12.5, 8], ['Rimadyl', 40, 20], ['Simparica', 5, 2]],
  },
  NEZnpqm: {
    asOf: now, appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a', objectId: 'NEZnpqm',
    columns: [
      { key: 'product', title: 'Product', role: 'dimension' },
      { key: 'units', title: 'Units', role: 'measure' },
    ],
    rows: [['Apoquel', 12], ['Rimadyl', 3]],
  },
};

const MOCK_STATE_KEY = 'covetrus.insight-hub.mock-state.v2';
const persistMockState = import.meta.env.DEV && import.meta.env.MODE !== 'test';

function loadState() {
  if (!persistMockState) return;
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_STATE_KEY) ?? 'null') as Partial<{
      artifacts: ArtifactSummary[]; users: PortalIdentity[]; groups: PortalGroup[]; memberships: GroupMember[];
      grants: ArtifactGrant[]; audit: typeof audit; notifications: NotificationFeed['items']; favoriteArtifactIds: string[];
      qlikBindings: QlikDatasetBinding[]; accessRequests: AccessRequestRecord[]; usageEvents: MockUsageEvent[];
    }> | null;
    if (!saved) return;
    if (Array.isArray(saved.artifacts)) artifacts = saved.artifacts;
    if (Array.isArray(saved.users)) users = saved.users;
    if (Array.isArray(saved.groups)) groups = saved.groups;
    if (Array.isArray(saved.memberships)) memberships = saved.memberships;
    if (Array.isArray(saved.grants)) grants = saved.grants;
    if (Array.isArray(saved.audit)) audit = saved.audit;
    if (Array.isArray(saved.notifications)) notifications = saved.notifications.map((item) => ({ ...item, subjectLabel: item.subjectLabel ?? null, type: item.type ?? 'dataset_refreshed' }));
    if (Array.isArray(saved.favoriteArtifactIds)) favoriteArtifactIds = new Set(saved.favoriteArtifactIds);
    if (Array.isArray(saved.qlikBindings)) qlikBindings = saved.qlikBindings;
    if (Array.isArray(saved.accessRequests)) accessRequests = saved.accessRequests;
    if (Array.isArray(saved.usageEvents)) usageEvents = saved.usageEvents;
  } catch { /* A corrupt development fixture falls back to the built-in sample. */ }
}

function saveState() {
  if (!persistMockState) return;
  try { localStorage.setItem(MOCK_STATE_KEY, JSON.stringify({ artifacts, users, groups, memberships, grants, audit, notifications, favoriteArtifactIds: [...favoriteArtifactIds], qlikBindings, accessRequests, usageEvents })); }
  catch { /* The in-memory fixture remains usable when browser storage is unavailable or full. */ }
}

function log(action: string, subjectType: string, subjectLabel: string, detail: string) {
  audit = [{ id: crypto.randomUUID(), occurredAt: new Date().toISOString(), actorEmail: users[0].email, action, subjectType, subjectLabel, detail }, ...audit];
  saveState();
}

function localPortalUrl(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
}

function inviteFileForUser(user: PortalIdentity): InviteDelivery {
  return downloadInviteFile(prepareInviteFile({ user, invitedBy: users[0], portalUrl: localPortalUrl() }));
}

function mockUsageInsights(range: UsageInsightsRange, current = new Date()): UsageInsights {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 28;
  const from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() - days + 1));
  const weeklyFrom = new Date(current.getTime() - 7 * 86_400_000);
  const monthlyFrom = new Date(current.getTime() - 28 * 86_400_000);
  const selected = usageEvents.filter((event) => Date.parse(event.occurredAt) >= from.getTime() && Date.parse(event.occurredAt) < current.getTime());
  const ready = selected.filter((event) => event.eventType === 'artifact_ready');
  const failed = selected.filter((event) => event.eventType === 'artifact_failed');
  const searches = selected.filter((event) => event.eventType === 'catalog_searched');
  const weeklyUsers = new Set(usageEvents.filter((event) => event.eventType === 'artifact_ready' && Date.parse(event.occurredAt) >= weeklyFrom.getTime()).map((event) => event.userId));
  const monthlyUsers = new Set(usageEvents.filter((event) => event.eventType === 'artifact_ready' && Date.parse(event.occurredAt) >= monthlyFrom.getTime()).map((event) => event.userId));
  const repeatUsers = [...weeklyUsers].filter((userId) => {
    const weeks = new Set(usageEvents.filter((event) => event.userId === userId && event.eventType === 'artifact_ready' && Date.parse(event.occurredAt) >= monthlyFrom.getTime() && Date.parse(event.occurredAt) < weeklyFrom.getTime()).map((event) => Math.floor((weeklyFrom.getTime() - Date.parse(event.occurredAt) - 1) / (7 * 86_400_000))));
    return weeks.size >= 2;
  }).length;
  const percent = (part: number, total: number) => total ? Math.round((part / total) * 10_000) / 100 : 0;
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + index)).toISOString().slice(0, 10);
    const rows = selected.filter((event) => event.occurredAt.slice(0, 10) === date);
    const dayReady = rows.filter((event) => event.eventType === 'artifact_ready');
    const daySearches = rows.filter((event) => event.eventType === 'catalog_searched');
    return { date, activeUsers: new Set(dayReady.map((event) => event.userId)).size, successfulLoads: dayReady.length, failedLoads: rows.filter((event) => event.eventType === 'artifact_failed').length, searches: daySearches.length, zeroResultSearches: daySearches.filter((event) => event.resultCount === 0).length };
  });
  const artifactInsights = artifacts.map((item) => {
    const rows = selected.filter((event) => event.artifactId === item.id);
    const successes = rows.filter((event) => event.eventType === 'artifact_ready');
    const failures = rows.filter((event) => event.eventType === 'artifact_failed');
    return { artifactId: item.id, title: item.title, kind: item.kind, uniqueUsers: new Set(successes.map((event) => event.userId)).size, successfulLoads: successes.length, failedLoads: failures.length, loadSuccessRate: percent(successes.length, successes.length + failures.length), lastUsedAt: successes.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt ?? null, favoriteAdds: rows.filter((event) => event.eventType === 'favorite_changed' && event.favoriteEnabled).length };
  }).filter((item) => item.successfulLoads || item.failedLoads || item.favoriteAdds).sort((a, b) => b.successfulLoads - a.successfulLoads || a.title.localeCompare(b.title));
  const zeroResultSearches = searches.filter((event) => event.resultCount === 0).length;
  return {
    range, from: from.toISOString(), to: current.toISOString(),
    summary: { weeklyActiveUsers: weeklyUsers.size, monthlyActiveUsers: monthlyUsers.size, repeatUsers, repeatUserRate: percent(repeatUsers, weeklyUsers.size), successfulLoads: ready.length, failedLoads: failed.length, loadSuccessRate: percent(ready.length, ready.length + failed.length), searches: searches.length, zeroResultSearches, zeroResultRate: percent(zeroResultSearches, searches.length), favoriteAdds: selected.filter((event) => event.eventType === 'favorite_changed' && event.favoriteEnabled).length, favoriteRemovals: selected.filter((event) => event.eventType === 'favorite_changed' && event.favoriteEnabled === false).length },
    activation: { activePortalUsers: users.filter((user) => user.status === 'active').length, usersWithPortalSession: new Set(selected.filter((event) => event.eventType === 'portal_session_started').map((event) => event.userId)).size, usersWithSuccessfulArtifact: new Set(ready.map((event) => event.userId)).size, repeatUsers },
    daily,
    artifacts: artifactInsights,
  };
}

export class MockPortalApi implements PortalApi {
  constructor() { loadState(); }
  async connect() {}
  async whoAmI() { loadState(); return structuredClone(users[0]); }
  async getBootstrap() {
    return { identity: await this.whoAmI(), catalog: await this.getMyCatalog(), notifications: await this.getNotifications(), features: { usageTelemetry: true, usageInsights: true } };
  }
  async recordUsageEvents(events: UsageEventInput[]) {
    const allowed = new Set(resolveCatalogForUser(users[0], artifacts, memberships, grants).map((item) => item.id));
    for (const event of events) {
      if (event.artifactId && !allowed.has(event.artifactId)) throw new Error('The library item is unavailable or access was denied.');
      if (!usageEvents.some((item) => item.id === event.id)) usageEvents.push({ ...structuredClone(event), userId: users[0].id });
    }
    saveState();
  }
  async getUsageInsights(range: UsageInsightsRange) { loadState(); return mockUsageInsights(range); }
  async completeOnboarding() {
    users[0] = { ...users[0], hasCompletedTour: true };
    saveState();
  }
  async getMyCatalog() {
    loadState();
    return structuredClone(resolveCatalogForUser(users[0], artifacts, memberships, grants).map((item) => ({
      ...item,
      isFavorite: favoriteArtifactIds.has(item.id),
      lastOpenedAt: usageEvents.filter((event) => event.userId === users[0].id && event.artifactId === item.id && event.eventType === 'artifact_ready').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt ?? null,
    })));
  }
  async setFavorite(artifactId: string, enabled: boolean) {
    if (!resolveCatalogForUser(users[0], artifacts, memberships, grants).some((item) => item.id === artifactId)) throw new Error('The library item is unavailable or access was denied.');
    if (enabled) favoriteArtifactIds.add(artifactId); else favoriteArtifactIds.delete(artifactId);
    usageEvents.push({ id: crypto.randomUUID(), eventType: 'favorite_changed', sessionId: crypto.randomUUID(), artifactId, occurredAt: new Date().toISOString(), userId: users[0].id, favoriteEnabled: enabled });
    saveState();
  }
  async getNotifications() {
    loadState();
    const allowed = new Set(resolveCatalogForUser(users[0], artifacts, memberships, grants).map((item) => item.id));
    const items = notifications.filter((item) => item.artifactId === null || allowed.has(item.artifactId));
    return structuredClone({ items, unreadCount: items.filter((item) => !item.readAt).length });
  }
  async getMyAccessRequest() {
    loadState();
    return structuredClone(accessRequests.find((item) => item.email === users[0].email) ?? null);
  }
  async submitAccessRequest(note: string) {
    const timestamp = new Date().toISOString();
    const existing = accessRequests.find((item) => item.email === users[0].email);
    const saved: AccessRequestRecord = existing
      ? { ...existing, note: note.trim().slice(0, 500), status: 'requested', updatedAt: timestamp }
      : { id: crypto.randomUUID(), email: users[0].email, displayName: users[0].displayName, note: note.trim().slice(0, 500), status: 'requested', createdAt: timestamp, updatedAt: timestamp };
    accessRequests = [saved, ...accessRequests.filter((item) => item.id !== saved.id)];
    log('access.requested', 'user', saved.email, saved.note || 'Portal access requested');
    return structuredClone(saved);
  }
  async approveAccessRequest(id: string, input: { role: PortalRole }) {
    const target = accessRequests.find((item) => item.id === id);
    if (!target) throw new Error('The access request was not found.');
    let user = users.find((candidate) => candidate.email === target.email);
    if (user) {
      user = { ...user, status: 'active' };
      users = users.map((candidate) => candidate.id === user!.id ? user! : candidate);
    } else {
      user = { id: crypto.randomUUID(), tenantId: 'local-development', entraObjectId: crypto.randomUUID(), email: target.email, displayName: target.displayName, role: input.role, status: 'active' };
      users = [...users, user];
    }
    accessRequests = accessRequests.map((item) => item.id === id ? { ...item, status: 'approved', updatedAt: new Date().toISOString() } : item);
    log('access.approved', 'user', target.email, 'Identity created from an access request');
    return structuredClone(user);
  }
  async dismissAccessRequest(id: string) {
    const target = accessRequests.find((item) => item.id === id);
    if (!target) throw new Error('The access request was not found.');
    accessRequests = accessRequests.map((item) => item.id === id ? { ...item, status: 'dismissed', updatedAt: new Date().toISOString() } : item);
    log('access.dismissed', 'user', target.email, 'Access request dismissed');
  }
  async markNotificationRead(id: string) {
    notifications = notifications.map((item) => item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item);
    saveState();
  }
  async markAllNotificationsRead() {
    const readAt = new Date().toISOString();
    notifications = notifications.map((item) => ({ ...item, readAt: item.readAt ?? readAt }));
    saveState();
  }
  async getArtifactData(artifactId: string, _datasetKey: string): Promise<DatasetEnvelope> {
    if (!resolveCatalogForUser(users[0], artifacts, memberships, grants).some((item) => item.id === artifactId)) throw new Error('Dataset is unavailable or access was denied.');
    throw new Error('Dataset is unavailable or access was denied.');
  }
  async seedDataset(artifactId: string, datasetKey: string, _payload: unknown) {
    log('dataset.seeded', 'artifact', artifactId, datasetKey);
    const item = artifacts.find((artifact) => artifact.id === artifactId);
    if (item) {
      const createdAt = new Date().toISOString();
      notifications = [{ id: crypto.randomUUID(), type: 'dataset_refreshed', artifactId, artifactSlug: item.slug, artifactTitle: item.title, artifactKind: item.kind, datasetKey, subjectLabel: null, generatedAt: createdAt, createdAt, readAt: null }, ...notifications];
    }
    saveState();
  }
  async getQlikBindingContext(artifactId: string, datasetKey: string) {
    loadState();
    return structuredClone({
      artifact: artifacts.find((item) => item.id === artifactId) ?? null,
      binding: qlikBindings.find((item) => item.artifactId === artifactId && item.datasetKey === datasetKey) ?? null,
      qlikConfigured: true,
    });
  }
  async saveQlikBinding(artifactId: string, datasetKey: string, input: QlikBindingInput) {
    const artifact = artifacts.find((item) => item.id === artifactId);
    if (!artifact?.datasetKeys.includes(datasetKey)) throw new Error('The dataset is not declared by this artifact.');
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), input.refreshHourUtc, input.refreshMinuteUtc, 0, 0));
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    const binding: QlikDatasetBinding = {
      artifactId, datasetKey, appId: input.appId.trim(), objectId: input.objectId.trim(),
      refreshHourUtc: input.refreshHourUtc, refreshMinuteUtc: input.refreshMinuteUtc, enabled: input.enabled !== false,
      lastPulledAt: qlikBindings.find((item) => item.artifactId === artifactId && item.datasetKey === datasetKey)?.lastPulledAt ?? null,
      lastError: null, lastRecordCount: qlikBindings.find((item) => item.artifactId === artifactId && item.datasetKey === datasetKey)?.lastRecordCount ?? null,
      nextDueAt: next.toISOString(), updatedAt: now.toISOString(),
      transform: {
        output: input.transform?.output ?? 'qlik',
        keys: input.transform?.keys ?? 'slug',
        keepColumns: input.transform?.keepColumns ?? [],
        dropEmptyRows: input.transform?.dropEmptyRows === true,
        rowFilterMode: input.transform?.rowFilterMode === 'or' ? 'or' : 'and',
        rowFilters: (input.transform?.rowFilters ?? []).map((item) => ({ ...item })),
      },
    };
    qlikBindings = [...qlikBindings.filter((item) => !(item.artifactId === artifactId && item.datasetKey === datasetKey)), binding];
    log('qlik.binding.saved', 'dataset', `${artifact.slug}/${datasetKey}`, input.objectId);
    return structuredClone(binding);
  }
  async deleteQlikBinding(artifactId: string, datasetKey: string) {
    if (!qlikBindings.some((item) => item.artifactId === artifactId && item.datasetKey === datasetKey)) throw new Error('No Qlik source is configured for this dataset.');
    qlikBindings = qlikBindings.filter((item) => !(item.artifactId === artifactId && item.datasetKey === datasetKey));
    log('qlik.binding.removed', 'dataset', datasetKey, artifactId);
  }
  async pullQlikBinding(artifactId: string, datasetKey: string): Promise<QlikDatasetBinding> {
    const current = qlikBindings.find((item) => item.artifactId === artifactId && item.datasetKey === datasetKey);
    if (!current) throw new Error('Save a Qlik app ID and object ID before pulling.');
    const sample = mockQlikSamples[current.objectId];
    if (!sample) throw new Error('The Qlik object was not found in that app.');
    const cleaned = applyQlikClean(sample, current.transform);
    const pulled: QlikDatasetBinding = {
      ...current, lastPulledAt: new Date().toISOString(), lastError: null, lastRecordCount: cleaned.rows.length,
    };
    qlikBindings = qlikBindings.map((item) => item.artifactId === artifactId && item.datasetKey === datasetKey ? pulled : item);
    saveState();
    return structuredClone(pulled);
  }
  async listQlikApps(query = '') {
    const needle = query.trim().toLowerCase();
    return structuredClone(mockQlikApps.filter((app) => !needle || app.name.toLowerCase().includes(needle) || app.description.toLowerCase().includes(needle)));
  }
  async listQlikTables(appId: string) {
    const tables = mockQlikTables[appId];
    if (!tables) throw new Error('Qlik Cloud did not open the app.');
    return structuredClone(tables);
  }
  async previewQlikTable(input: { appId: string; objectId: string }): Promise<QlikPreviewSample> {
    const sample = mockQlikSamples[input.objectId];
    if (!sample || sample.appId !== input.appId) throw new Error('The Qlik object was not found in that app.');
    return structuredClone({
      appId: sample.appId, objectId: sample.objectId, columns: sample.columns, rows: sample.rows,
      sourceRowCount: sample.rows.length, truncated: false,
    });
  }
  async getAdminSnapshot(): Promise<AdminSnapshot> {
    loadState();
    return structuredClone({ users, groups, memberships, grants, artifacts, datasets: [], qlikBindings, qlikConfigured: true, audit, accessRequests });
  }
  async addUser(input: { email: string; displayName: string; role: PortalRole }) {
    const user: PortalIdentity = { id: crypto.randomUUID(), tenantId: 'local-development', entraObjectId: null, email: input.email.toLowerCase(), displayName: input.displayName, role: input.role, status: 'pending' };
    users = [...users, user]; log('user.created', 'user', user.email, 'Pending identity created');
    return { ...structuredClone(user), invite: inviteFileForUser(user) };
  }
  async resendUserInvite(id: string): Promise<InviteDelivery> {
    const user = users.find((candidate) => candidate.id === id);
    if (!user) return { status: 'failed', message: 'The user was not found.' };
    return inviteFileForUser(user);
  }
  async updateUser(id: string, patch: { status?: UserStatus; role?: PortalRole }) {
    users = users.map((user) => user.id === id ? { ...user, ...patch } : user);
    const user = users.find((candidate) => candidate.id === id); if (user) log('user.updated', 'user', user.email, JSON.stringify(patch));
  }
  async deleteUser(id: string) {
    const user = users.find((candidate) => candidate.id === id);
    if (!user) throw new Error('The user was not found.');
    if (user.role === 'admin') throw new Error('You cannot remove your own administrator account.');
    users = users.filter((candidate) => candidate.id !== id);
    memberships = memberships.filter((item) => item.userId !== id);
    groups = groups.map((group) => ({ ...group, memberCount: memberships.filter((item) => item.groupId === group.id).length }));
    grants = grants.filter((grant) => grant.targetType !== 'user' || grant.targetId !== id);
    usageEvents = usageEvents.filter((event) => event.userId !== id);
    log('user.deleted', 'user', user.email, 'Portal identity and access assignments removed');
  }
  async addGroup(input: { name: string; description: string }) {
    const group = { id: crypto.randomUUID(), name: input.name, description: input.description, memberCount: 0 };
    groups = [...groups, group]; log('group.created', 'group', group.name, group.description); return structuredClone(group);
  }
  async addMembership(groupId: string, userId: string) {
    if (memberships.some((item) => item.groupId === groupId && item.userId === userId)) return;
    memberships = [...memberships, { id: crypto.randomUUID(), groupId, userId }];
    groups = groups.map((group) => group.id === groupId ? { ...group, memberCount: group.memberCount + 1 } : group);
    log('membership.created', 'group', groups.find((group) => group.id === groupId)?.name ?? groupId, users.find((user) => user.id === userId)?.email ?? userId);
  }
  async removeMembership(groupId: string, userId: string) {
    memberships = memberships.filter((item) => item.groupId !== groupId || item.userId !== userId);
    groups = groups.map((group) => group.id === groupId ? { ...group, memberCount: Math.max(0, group.memberCount - 1) } : group);
    log('membership.removed', 'group', groups.find((group) => group.id === groupId)?.name ?? groupId, users.find((user) => user.id === userId)?.email ?? userId);
  }
  async setGrant(input: { artifactId: string; targetType: 'user' | 'group'; targetId: string; enabled: boolean }) {
    grants = grants.filter((grant) => !(grant.artifactId === input.artifactId && grant.targetType === input.targetType && grant.targetId === input.targetId));
    if (input.enabled) grants = [...grants, { id: crypto.randomUUID(), artifactId: input.artifactId, targetType: input.targetType, targetId: input.targetId }];
    log(input.enabled ? 'grant.created' : 'grant.removed', input.targetType, input.targetId, artifacts.find((artifact) => artifact.id === input.artifactId)?.title ?? input.artifactId);
  }
  async preflightArtifact(input: Parameters<PortalApi['preflightArtifact']>[0]) {
    const file = input.html ?? input.zip;
    if (!file) throw new Error('Upload an HTML file or a zip package.');
    return {
      status: 'ready' as const,
      preflightToken: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      previewUrl: URL.createObjectURL(file),
      inputBytes: file.size,
      normalizedBytes: file.size,
      dependencies: [], transformations: [], warnings: [], blockers: [],
    };
  }
  async publishArtifact(input: Parameters<PortalApi['publishArtifact']>[0]) {
    const file = input.html ?? input.zip;
    if (!file && !input.preflightToken) throw new Error('Upload an HTML file or a zip package.');
    const slug = (input.slug || input.title).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    if (!slug) throw new Error('Enter a title that can be turned into a URL slug.');
    const existing = artifacts.find((item) => item.slug === slug);
    const id = existing?.id ?? crypto.randomUUID();
    const version = existing ? existing.version.replace(/(\d+)$/, (value) => String(Number(value) + 1)) : '1.0.0';
    const datasetKeys = (input.jsonFiles ?? []).map((json) => json.name.replace(/\.json$/i, '').toLowerCase());
    const timestamp = new Date().toISOString();
    const item: ArtifactSummary = {
      id, slug, title: input.title, description: input.description, kind: input.kind, version,
      owner: input.owner, dataDate: input.dataDate ?? null, entryUrl: `/artifacts/${slug}/index.html?v=${encodeURIComponent(version)}`,
      publishedAt: existing?.publishedAt ?? timestamp, updatedAt: timestamp,
      capabilities: input.capabilities ?? [], datasetKeys, accent: input.kind === 'report' ? 'teal' : 'blue', icon: input.icon,
      source: 'uploaded', hostedHtml: file ? await file.text() : '<html><body>Preflighted artifact</body></html>',
    };
    artifacts = existing ? artifacts.map((candidate) => candidate.id === id ? item : candidate) : [...artifacts, item];
    if (!grants.some((grant) => grant.artifactId === id && grant.targetType === 'user' && grant.targetId === users[0].id)) {
      grants = [...grants, { id: crypto.randomUUID(), artifactId: id, targetType: 'user', targetId: users[0].id }];
    }
    log(existing ? 'artifact.replaced' : 'artifact.published', 'artifact', slug, version);
    return structuredClone(item);
  }
  async linkArtifact(input: Parameters<PortalApi['linkArtifact']>[0]) {
    const entryUrl = parseLinkedAppUrl(input.url);
    const slug = (input.slug || input.title).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    if (!slug) throw new Error('Enter a title that can be turned into a URL slug.');
    const existing = artifacts.find((item) => item.slug === slug);
    if (existing && existing.source !== 'linked') throw new Error('That title is already used. Choose a different title.');
    const id = existing?.id ?? crypto.randomUUID();
    const version = existing ? existing.version.replace(/(\d+)$/, (value) => String(Number(value) + 1)) : '1.0.0';
    const timestamp = new Date().toISOString();
    const item: ArtifactSummary = {
      id, slug, title: input.title, description: input.description, kind: input.kind, version,
      owner: input.owner, dataDate: null, entryUrl,
      publishedAt: existing?.publishedAt ?? timestamp, updatedAt: timestamp,
      capabilities: [], datasetKeys: [], accent: input.kind === 'report' ? 'teal' : 'blue', icon: input.icon,
      source: 'linked',
    };
    artifacts = existing ? artifacts.map((candidate) => candidate.id === id ? item : candidate) : [...artifacts, item];
    if (!grants.some((grant) => grant.artifactId === id && grant.targetType === 'user' && grant.targetId === users[0].id)) {
      grants = [...grants, { id: crypto.randomUUID(), artifactId: id, targetType: 'user', targetId: users[0].id }];
    }
    log(existing ? 'artifact.replaced' : 'artifact.published', 'artifact', slug, version);
    return structuredClone(item);
  }
  async replaceArtifactBundle(id: string, input: { html?: File; zip?: File; jsonFiles?: File[] }) {
    const current = artifacts.find((item) => item.id === id && item.source === 'uploaded');
    if (!current) throw new Error('The published artifact was not found.');
    return this.publishArtifact({
      title: current.title, description: current.description, kind: current.kind, owner: current.owner,
      dataDate: current.dataDate ?? undefined, slug: current.slug, capabilities: current.capabilities, icon: current.icon,
      html: input.html, zip: input.zip, jsonFiles: input.jsonFiles,
    });
  }
  async updatePublishedArtifact(id: string, patch: Parameters<PortalApi['updatePublishedArtifact']>[1]) {
    const current = artifacts.find((item) => item.id === id && (item.source === 'uploaded' || item.source === 'linked'));
    if (!current) throw new Error('The published artifact was not found.');
    if (patch.isActive === false) {
      artifacts = artifacts.filter((item) => item.id !== id);
      grants = grants.filter((grant) => grant.artifactId !== id);
      log('artifact.unpublished', 'artifact', current.slug, current.title);
      return;
    }
    if (patch.url !== undefined && current.source !== 'linked') throw new Error('Only linked apps have an external URL.');
    const { url, ...rest } = patch;
    const nextUrl = url !== undefined ? parseLinkedAppUrl(url) : current.entryUrl;
    artifacts = artifacts.map((item) => item.id === id ? { ...item, ...rest, entryUrl: nextUrl, updatedAt: new Date().toISOString() } : item);
    log('artifact.updated', 'artifact', current.slug, current.title);
  }
  async deletePublishedArtifact(id: string) {
    const current = artifacts.find((item) => item.id === id && (item.source === 'uploaded' || item.source === 'linked'));
    if (!current) throw new Error('The published artifact was not found.');
    artifacts = artifacts.filter((item) => item.id !== id);
    grants = grants.filter((grant) => grant.artifactId !== id);
    notifications = notifications.filter((item) => item.artifactId !== id);
    qlikBindings = qlikBindings.filter((item) => item.artifactId !== id);
    log('artifact.deleted', 'artifact', current.slug, current.title);
  }
}
