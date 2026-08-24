import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpPortalApi } from '@/services/HttpPortalApi';

const artifact = {
  id: 'artifact-1', slug: 'spc-test', title: 'SPC Test', description: 'SPC for PDOL',
  kind: 'report' as const, version: '1.0.0', owner: 'Greig Dunbar', dataDate: null,
  entryUrl: '/artifacts/spc-test/index.html', capabilities: [], datasetKeys: [],
  accent: 'teal' as const, source: 'uploaded' as const,
};

describe('HttpPortalApi request bodies', () => {
  it('persists completion of the signed-in user onboarding tour', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => undefined }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpPortalApi();

    await api.completeOnboarding();

    expect(fetchMock).toHaveBeenCalledWith('/api/portal/onboarding', expect.objectContaining({ method: 'PUT' }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('leaves the Content-Type unset for multipart artifact uploads', async () => {
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 201, json: async () => artifact }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpPortalApi();

    await api.publishArtifact({
      title: artifact.title,
      description: artifact.description,
      kind: artifact.kind,
      owner: artifact.owner,
      html: new File(['<html><body>SPC</body></html>'], 'PDOL_SKU_Watchlist_SPC.html', { type: 'text/html' }),
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    expect(init?.headers).toBeUndefined();
  });

  it('preflights multipart content and publishes the resulting opaque token', async () => {
    const report = { status: 'ready', preflightToken: 'token-1', inputBytes: 10, normalizedBytes: 20, dependencies: [], transformations: [], warnings: [], blockers: [] };
    const fetchMock = vi.fn(async (path: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: String(path).endsWith('/preflight') ? 200 : 201, json: async () => String(path).endsWith('/preflight') ? report : artifact }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpPortalApi();
    const file = new File(['<html></html>'], 'report.html', { type: 'text/html' });

    await api.preflightArtifact({ html: file });
    await api.publishArtifact({ title: artifact.title, description: artifact.description, kind: artifact.kind, owner: artifact.owner, preflightToken: 'token-1' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/artifacts/preflight');
    expect((fetchMock.mock.calls[0]?.[1]?.body as FormData).get('file')).toBe(file);
    expect((fetchMock.mock.calls[1]?.[1]?.body as FormData).get('preflightToken')).toBe('token-1');
    expect((fetchMock.mock.calls[1]?.[1]?.body as FormData).get('file')).toBeNull();
  });

  it('sets JSON Content-Type for serialized JSON mutations', async () => {
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 204, json: async () => undefined }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpPortalApi();

    await api.setGrant({ artifactId: 'artifact-1', targetType: 'user', targetId: 'user-1', enabled: true });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.cache).toBe('no-store');
  });

  it('stores a favourite against the signed-in user', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => undefined }));
    vi.stubGlobal('fetch', fetchMock);

    await new HttpPortalApi().setFavorite('report/1', true);

    expect(fetchMock).toHaveBeenCalledWith('/api/favorites/report%2F1', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: true }) }));
  });

  it('uses permanent DELETE endpoints for users and live-published artifacts', async () => {
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 204, json: async () => undefined }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpPortalApi();

    await api.deleteUser('user/1');
    await api.deletePublishedArtifact('artifact/1');

    expect(fetchMock.mock.calls[0]).toEqual(['/api/admin/users/user%2F1', expect.objectContaining({ method: 'DELETE', cache: 'no-store' })]);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/admin/artifacts/artifact%2F1', expect.objectContaining({ method: 'DELETE', cache: 'no-store' })]);
  });

  it('posts a user invite resend to the admin users collection', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'downloaded', message: 'Open launchpad-invite-alex.eml in Outlook and click Send to invite alex@covetrus.com.' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await new HttpPortalApi().resendUserInvite('user/1');

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/user%2F1/invite', expect.objectContaining({ method: 'POST' }));
  });

  it('saves and pulls a Qlik dataset binding over JSON', async () => {
    const binding = { artifactId: 'artifact-1', datasetKey: 'report', appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'obj-1', refreshHourUtc: 8, refreshMinuteUtc: 0, enabled: true, lastPulledAt: null, lastError: null, lastRecordCount: null, nextDueAt: '2026-08-22T08:00:00.000Z', updatedAt: '2026-08-21T21:00:00.000Z' };
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => ({
      ok: true, status: init?.method === 'DELETE' ? 204 : 200, json: async () => binding,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpPortalApi();

    await api.saveQlikBinding('artifact/1', 'report json', { appId: binding.appId, objectId: binding.objectId, refreshHourUtc: 8, refreshMinuteUtc: 0 });
    await api.pullQlikBinding('artifact/1', 'report json');
    await api.deleteQlikBinding('artifact/1', 'report json');
    await api.listQlikApps('cosi');
    await api.listQlikTables('app/1');
    await api.previewQlikTable({ appId: binding.appId, objectId: binding.objectId });

    expect(fetchMock.mock.calls[0]).toEqual(['/api/admin/artifacts/artifact%2F1/datasets/report%20json/qlik', expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'application/json' } })]);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/admin/artifacts/artifact%2F1/datasets/report%20json/qlik/pull', expect.objectContaining({ method: 'POST' })]);
    expect(fetchMock.mock.calls[2]).toEqual(['/api/admin/artifacts/artifact%2F1/datasets/report%20json/qlik', expect.objectContaining({ method: 'DELETE' })]);
    expect(fetchMock.mock.calls[3]).toEqual(['/api/admin/qlik/apps?query=cosi', expect.anything()]);
    expect(fetchMock.mock.calls[4]).toEqual(['/api/admin/qlik/apps/app%2F1/tables', expect.anything()]);
    expect(fetchMock.mock.calls[5][0]).toBe('/api/admin/qlik/preview');
  });
});
