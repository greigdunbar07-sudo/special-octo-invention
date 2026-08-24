import type { AccessRequestRecord, AdminSnapshot, ArtifactCompatibilityReport, ArtifactSummary, DatasetEnvelope, InviteDelivery, NotificationFeed, PortalApi, PortalBootstrap, PortalGroup, PortalIdentity, PortalRole, QlikAppSummary, QlikBindingContext, QlikBindingInput, QlikDatasetBinding, QlikPreviewSample, QlikTableSummary, UsageEventInput, UsageInsights, UsageInsightsRange, UserStatus } from '@/types/portal';

interface ApiErrorPayload { error?: { code?: string; message?: string } }

/** Carries the structured server error code so pages can branch on it. */
export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

const QLIK_CATALOG_TIMEOUT_MS = 150_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = typeof init?.body === 'string';
  const method = (init?.method ?? 'GET').toUpperCase();
  const response = await fetch(path, {
    credentials: 'same-origin',
    // GETs revalidate with conditional requests (ETag/304); writes bypass the HTTP cache entirely.
    cache: method === 'GET' ? 'no-cache' : 'no-store',
    ...init,
    headers: hasJsonBody ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  });
  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try { payload = await response.json() as ApiErrorPayload; } catch { /* use the safe fallback below */ }
    throw new ApiError(payload.error?.code || 'REQUEST_FAILED', payload.error?.message || `The portal service failed (${response.status}).`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestWithTimeout<T>(path: string, timeoutMs: number, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request<T>(path, { ...init, signal: controller.signal });
  } catch (caught) {
    if (controller.signal.aborted || (caught instanceof DOMException && caught.name === 'AbortError')) {
      throw new Error('Qlik is still opening that app. Wait a minute and try again.');
    }
    throw caught;
  } finally {
    clearTimeout(timer);
  }
}

export class HttpPortalApi implements PortalApi {
  async connect(): Promise<void> { await request('/api/auth/me'); }
  whoAmI() { return request<PortalIdentity>('/api/portal/me'); }
  getBootstrap() { return request<PortalBootstrap>('/api/portal/bootstrap'); }
  recordUsageEvents(events: UsageEventInput[]) { return request<void>('/api/usage/events', { method: 'POST', body: JSON.stringify({ events }), keepalive: true }); }
  getUsageInsights(range: UsageInsightsRange) { return request<UsageInsights>(`/api/admin/usage-insights?range=${encodeURIComponent(range)}`); }
  getMyAccessRequest() { return request<AccessRequestRecord | null>('/api/portal/access-request'); }
  submitAccessRequest(note: string) { return request<AccessRequestRecord>('/api/portal/access-request', { method: 'POST', body: JSON.stringify({ note }) }); }
  approveAccessRequest(id: string, input: { role: PortalRole }) { return request<PortalIdentity>(`/api/admin/access-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify(input) }); }
  dismissAccessRequest(id: string) { return request<void>(`/api/admin/access-requests/${encodeURIComponent(id)}/dismiss`, { method: 'POST' }); }
  completeOnboarding() { return request<void>('/api/portal/onboarding', { method: 'PUT' }); }
  getMyCatalog() { return request<ArtifactSummary[]>('/api/catalog'); }
  setFavorite(artifactId: string, enabled: boolean) { return request<void>(`/api/favorites/${encodeURIComponent(artifactId)}`, { method: 'PUT', body: JSON.stringify({ enabled }) }); }
  getNotifications() { return request<NotificationFeed>('/api/notifications'); }
  markNotificationRead(id: string) { return request<void>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PUT' }); }
  markAllNotificationsRead() { return request<void>('/api/notifications/read-all', { method: 'PUT' }); }
  getArtifactData(artifactId: string, datasetKey: string) { return request<DatasetEnvelope>(`/api/artifacts/${encodeURIComponent(artifactId)}/datasets/${encodeURIComponent(datasetKey)}`); }
  seedDataset(artifactId: string, datasetKey: string, payload: unknown) { return request<void>(`/api/admin/artifacts/${encodeURIComponent(artifactId)}/datasets/${encodeURIComponent(datasetKey)}`, { method: 'POST', body: JSON.stringify(payload) }); }
  getQlikBindingContext(artifactId: string, datasetKey: string) {
    return request<QlikBindingContext>(`/api/admin/artifacts/${encodeURIComponent(artifactId)}/datasets/${encodeURIComponent(datasetKey)}/qlik`);
  }
  saveQlikBinding(artifactId: string, datasetKey: string, input: QlikBindingInput) {
    return request<QlikDatasetBinding>(`/api/admin/artifacts/${encodeURIComponent(artifactId)}/datasets/${encodeURIComponent(datasetKey)}/qlik`, { method: 'PUT', body: JSON.stringify(input) });
  }
  deleteQlikBinding(artifactId: string, datasetKey: string) {
    return request<void>(`/api/admin/artifacts/${encodeURIComponent(artifactId)}/datasets/${encodeURIComponent(datasetKey)}/qlik`, { method: 'DELETE' });
  }
  pullQlikBinding(artifactId: string, datasetKey: string) {
    return request<QlikDatasetBinding>(`/api/admin/artifacts/${encodeURIComponent(artifactId)}/datasets/${encodeURIComponent(datasetKey)}/qlik/pull`, { method: 'POST' });
  }
  listQlikApps(query = '') {
    const search = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : '';
    return request<QlikAppSummary[]>(`/api/admin/qlik/apps${search}`);
  }
  listQlikTables(appId: string) {
    return requestWithTimeout<QlikTableSummary[]>(`/api/admin/qlik/apps/${encodeURIComponent(appId)}/tables`, QLIK_CATALOG_TIMEOUT_MS);
  }
  previewQlikTable(input: { appId: string; objectId: string }) {
    return requestWithTimeout<QlikPreviewSample>('/api/admin/qlik/preview', QLIK_CATALOG_TIMEOUT_MS, { method: 'POST', body: JSON.stringify(input) });
  }
  getAdminSnapshot() { return request<AdminSnapshot>('/api/admin/snapshot'); }
  addUser(input: { email: string; displayName: string; role: PortalRole }) { return request<PortalIdentity & { invite: InviteDelivery }>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) }); }
  resendUserInvite(id: string) { return request<InviteDelivery>(`/api/admin/users/${encodeURIComponent(id)}/invite`, { method: 'POST' }); }
  updateUser(id: string, patch: { status?: UserStatus; role?: PortalRole }) { return request<void>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
  deleteUser(id: string) { return request<void>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  addGroup(input: { name: string; description: string }) { return request<PortalGroup>('/api/admin/groups', { method: 'POST', body: JSON.stringify(input) }); }
  addMembership(groupId: string, userId: string) { return request<void>(`/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: 'PUT' }); }
  removeMembership(groupId: string, userId: string) { return request<void>(`/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }); }
  setGrant(input: { artifactId: string; targetType: 'user' | 'group'; targetId: string; enabled: boolean }) {
    return request<void>(`/api/admin/grants/${encodeURIComponent(input.artifactId)}/${input.targetType}/${encodeURIComponent(input.targetId)}`, { method: 'PUT', body: JSON.stringify({ enabled: input.enabled }) });
  }
  preflightArtifact(input: Parameters<PortalApi['preflightArtifact']>[0]) {
    const data = new FormData();
    if (input.html) data.set('file', input.html);
    if (input.zip) data.set('file', input.zip);
    for (const file of input.jsonFiles ?? []) data.append('json', file);
    return request<ArtifactCompatibilityReport>('/api/admin/artifacts/preflight', { method: 'POST', body: data });
  }
  publishArtifact(input: Parameters<PortalApi['publishArtifact']>[0]) {
    const data = new FormData();
    data.set('title', input.title);
    data.set('description', input.description);
    data.set('kind', input.kind);
    data.set('owner', input.owner);
    if (input.dataDate) data.set('dataDate', input.dataDate);
    if (input.slug) data.set('slug', input.slug);
    if (input.capabilities?.includes('downloads')) data.set('downloads', 'true');
    if (input.icon) data.set('icon', input.icon);
    if (input.preflightToken) data.set('preflightToken', input.preflightToken);
    if (input.html) data.set('file', input.html);
    if (input.zip) data.set('file', input.zip);
    for (const file of input.jsonFiles ?? []) data.append('json', file);
    return request<ArtifactSummary>('/api/admin/artifacts', { method: 'POST', body: data });
  }
  replaceArtifactBundle(id: string, input: { html?: File; zip?: File; jsonFiles?: File[] }) {
    const data = new FormData();
    if (input.html) data.set('file', input.html);
    if (input.zip) data.set('file', input.zip);
    for (const file of input.jsonFiles ?? []) data.append('json', file);
    return request<ArtifactSummary>(`/api/admin/artifacts/${encodeURIComponent(id)}/bundle`, { method: 'POST', body: data });
  }
  updatePublishedArtifact(id: string, patch: Parameters<PortalApi['updatePublishedArtifact']>[1]) {
    return request<void>(`/api/admin/artifacts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  deletePublishedArtifact(id: string) {
    return request<void>(`/api/admin/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
