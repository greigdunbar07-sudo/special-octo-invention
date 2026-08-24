import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from '@/pages/AdminPage';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { ToastProvider } from '@/hooks/ToastContext';
import type { AdminSnapshot, PortalIdentity, QlikRowFilter } from '@/types/portal';

const mocks = vi.hoisted(() => {
  const admin: PortalIdentity = {
    id: 'admin-1', tenantId: 'tenant-1', entraObjectId: 'entra-1',
    email: 'admin@example.com', displayName: 'Admin User', role: 'admin', status: 'active',
  };
  const artifact = {
    id: 'artifact-1', slug: 'report', title: 'Operations report', description: 'Report',
    kind: 'report' as const, version: '1.0.0', owner: 'Operations', dataDate: null,
    entryUrl: '/report', capabilities: [], datasetKeys: ['report'], accent: 'teal' as const, source: 'bundled' as const,
  };
  const uploadedArtifact = {
    ...artifact, id: 'artifact-uploaded', slug: 'live-report', title: 'Live report',
    entryUrl: '/artifacts/live-report/index.html', datasetKeys: [] as string[], source: 'uploaded' as const, isActive: false,
  };
  let snapshot: AdminSnapshot;
  return {
    admin,
    features: { usageTelemetry: false, usageInsights: false },
    reset() { snapshot = { users: [admin], groups: [], memberships: [], grants: [], artifacts: [artifact, uploadedArtifact], datasets: [], qlikBindings: [], qlikConfigured: false, audit: [], accessRequests: [] }; },
    addAccessRequest() {
      snapshot = { ...snapshot, accessRequests: [{ id: 'request-1', email: 'newcomer@example.com', displayName: 'New Comer', note: 'I need the weekly reports.', status: 'requested' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] };
    },
    portalApi: {
      getAdminSnapshot: vi.fn(async () => structuredClone(snapshot)),
      getUsageInsights: vi.fn(async (range: '7d' | '28d' | '90d') => ({
        range, from: '2026-07-26T00:00:00Z', to: '2026-08-23T00:00:00Z',
        summary: { weeklyActiveUsers: 12, monthlyActiveUsers: 31, repeatUsers: 8, repeatUserRate: 66.7, successfulLoads: 80, failedLoads: 2, loadSuccessRate: 97.6, searches: 20, zeroResultSearches: 3, zeroResultRate: 15, favoriteAdds: 4, favoriteRemovals: 1 },
        activation: { activePortalUsers: 40, usersWithPortalSession: 34, usersWithSuccessfulArtifact: 31, repeatUsers: 8 },
        daily: [{ date: '2026-08-22', activeUsers: 7, successfulLoads: 11, failedLoads: 1, searches: 3, zeroResultSearches: 0 }],
        artifacts: [{ artifactId: 'artifact-1', title: 'Operations report', kind: 'report' as const, uniqueUsers: 10, successfulLoads: 30, failedLoads: 1, loadSuccessRate: 96.8, lastUsedAt: '2026-08-22T09:00:00Z', favoriteAdds: 2 }],
      })),
      addUser: vi.fn(async (input: { email: string; displayName: string }) => {
        const viewer: PortalIdentity = { id: 'viewer-1', tenantId: 'tenant-1', entraObjectId: null, email: input.email, displayName: input.displayName, role: 'viewer', status: 'pending' };
        snapshot = { ...snapshot, users: [...snapshot.users, viewer] };
        return { ...viewer, invite: { status: 'downloaded' as const, message: `Open launchpad-invite-new-viewer.eml in Outlook and click Send to invite ${input.email}.` } };
      }),
      resendUserInvite: vi.fn(async () => ({ status: 'downloaded' as const, message: 'Open launchpad-invite-admin-user.eml in Outlook and click Send to invite admin@example.com.' })),
      updateUser: vi.fn(async (id: string, patch: Partial<Pick<PortalIdentity, 'role' | 'status'>>) => {
        snapshot = { ...snapshot, users: snapshot.users.map((item) => item.id === id ? { ...item, ...patch } : item) };
      }),
      deleteUser: vi.fn(async (id: string) => {
        snapshot = { ...snapshot, users: snapshot.users.filter((user) => user.id !== id) };
      }),
      setGrant: vi.fn(async (input: { artifactId: string; targetType: 'user' | 'group'; targetId: string; enabled: boolean }) => {
        const grants = snapshot.grants.filter((grant) => !(grant.artifactId === input.artifactId && grant.targetType === input.targetType && grant.targetId === input.targetId));
        snapshot = { ...snapshot, grants: input.enabled ? [...grants, { id: 'grant-1', artifactId: input.artifactId, targetType: input.targetType, targetId: input.targetId }] : grants };
      }),
      preflightArtifact: vi.fn(async () => ({
        status: 'ready' as const, preflightToken: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(),
        previewUrl: '/api/admin/artifacts/preflight/11111111-1111-4111-8111-111111111111/preview', inputBytes: 13, normalizedBytes: 42,
        dependencies: [], transformations: [{ code: 'SCRIPT_INLINED', source: 'chart.js', message: 'Embedded a script dependency.' }], warnings: [], blockers: [],
      })),
      publishArtifact: vi.fn(async (input: { title: string; description: string; kind: 'report' | 'tool'; owner: string }) => {
        const published = {
          id: 'artifact-2', slug: 'cowork-report', title: input.title, description: input.description,
          kind: input.kind, version: '1.0.0', owner: input.owner, dataDate: null,
          entryUrl: '/artifacts/cowork-report/index.html', capabilities: [], datasetKeys: [] as string[],
          accent: 'teal' as const, source: 'uploaded' as const,
        };
        snapshot = { ...snapshot, artifacts: [...snapshot.artifacts, published] };
        return published;
      }),
      updatePublishedArtifact: vi.fn(async () => undefined),
      deletePublishedArtifact: vi.fn(async (id: string) => {
        snapshot = { ...snapshot, artifacts: snapshot.artifacts.filter((item) => item.id !== id) };
      }),
      saveQlikBinding: vi.fn(async (artifactId: string, datasetKey: string, input: { appId: string; objectId: string; refreshHourUtc: number; refreshMinuteUtc: number; transform?: { output: 'qlik' | 'rows' | 'as-of-rows'; keys: 'slug' | 'title'; keepColumns: string[]; dropEmptyRows: boolean; rowFilterMode: 'and' | 'or'; rowFilters: QlikRowFilter[] } }) => {
        const binding = {
          artifactId, datasetKey, appId: input.appId, objectId: input.objectId,
          refreshHourUtc: input.refreshHourUtc, refreshMinuteUtc: input.refreshMinuteUtc, enabled: true,
          lastPulledAt: null, lastError: null, lastRecordCount: null,
          nextDueAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          transform: input.transform ?? { output: 'qlik' as const, keys: 'slug' as const, keepColumns: [] as string[], dropEmptyRows: false, rowFilterMode: 'and' as const, rowFilters: [] },
        };
        snapshot = { ...snapshot, qlikBindings: [...snapshot.qlikBindings.filter((item) => !(item.artifactId === artifactId && item.datasetKey === datasetKey)), binding] };
        return binding;
      }),
      pullQlikBinding: vi.fn(async () => { throw new Error('Set QLIK_TENANT_URL and QLIK_API_KEY on the App Service, then try again.'); }),
      deleteQlikBinding: vi.fn(async () => undefined),
      approveAccessRequest: vi.fn(async (id: string) => {
        const request = snapshot.accessRequests.find((item) => item.id === id)!;
        const approved: PortalIdentity = { id: 'approved-1', tenantId: 'tenant-1', entraObjectId: 'entra-2', email: request.email, displayName: request.displayName, role: 'viewer', status: 'active' };
        snapshot = { ...snapshot, users: [...snapshot.users, approved], accessRequests: snapshot.accessRequests.map((item) => item.id === id ? { ...item, status: 'approved' as const } : item) };
        return approved;
      }),
      dismissAccessRequest: vi.fn(async (id: string) => {
        snapshot = { ...snapshot, accessRequests: snapshot.accessRequests.map((item) => item.id === id ? { ...item, status: 'dismissed' as const } : item) };
      }),
      addMembership: vi.fn(async () => undefined),
    },
  };
});

vi.mock('@/hooks/PortalContext', () => ({
  usePortal: () => ({ identity: mocks.admin, loading: false, refreshCatalog: vi.fn(), refreshNotifications: vi.fn(), features: mocks.features }),
}));
vi.mock('@/services/portalApi', () => ({ portalApi: mocks.portalApi }));

function renderAdmin(path = '/admin') {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider><ConfirmProvider><AdminPage /></ConfirmProvider></ToastProvider></MemoryRouter>);
}

async function confirmDialog(user: ReturnType<typeof userEvent.setup>, action: string) {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: action }));
}

describe('AdminPage access changes', () => {
  beforeEach(() => {
    mocks.reset();
    mocks.features.usageInsights = false;
    mocks.features.usageTelemetry = false;
    vi.clearAllMocks();
  });

  it('shows aggregate usage insights without individual viewing history', async () => {
    mocks.features.usageInsights = true;
    renderAdmin('/admin?tab=insights');
    expect(await screen.findByRole('heading', { name: 'Usage insights' })).toBeInTheDocument();
    expect(await screen.findByText('97.6%')).toBeInTheDocument();
    expect(screen.getByText('Operations report')).toBeInTheDocument();
    expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
    expect(mocks.portalApi.getUsageInsights).toHaveBeenCalledWith('28d');
  });

  it('shows a new viewer and their access change without reloading the page', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await screen.findByText('Admin User');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await user.type(screen.getByLabelText('Name'), 'New Viewer');
    await user.type(screen.getByLabelText('Email'), 'viewer@example.com');
    await user.click(screen.getByRole('button', { name: 'Add viewer' }));

    await screen.findByText('New Viewer');
    expect(screen.getByText('viewer@example.com')).toBeInTheDocument();
    expect(await screen.findByText('Invite downloaded')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Access matrix/ }));
    await user.click(screen.getAllByRole('button', { name: 'Users' }).at(-1)!);
    const viewerRow = screen.getByText('New Viewer').closest('tr');
    expect(viewerRow).not.toBeNull();
    const checkbox = within(viewerRow!).getByRole('checkbox', { name: 'Grant Operations report to New Viewer' });
    await user.click(checkbox);

    await waitFor(() => expect(checkbox).toBeChecked());
    expect(mocks.portalApi.addUser).toHaveBeenCalledOnce();
    expect(mocks.portalApi.setGrant).toHaveBeenCalledWith({ artifactId: 'artifact-1', targetType: 'user', targetId: 'viewer-1', enabled: true });
  });

  it('force-sends an invite to an existing active administrator, including the signed-in user', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await screen.findByText('Admin User');
    await user.click(screen.getByRole('button', { name: 'Send invite to Admin User' }));

    expect(await screen.findByText('Invite downloaded')).toBeInTheDocument();
    expect(mocks.portalApi.resendUserInvite).toHaveBeenCalledWith('admin-1');
  });

  it('permanently removes a non-administrator after confirmation', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText('Admin User');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await user.type(screen.getByLabelText('Name'), 'Remove Me');
    await user.type(screen.getByLabelText('Email'), 'remove@example.com');
    await user.click(screen.getByRole('button', { name: 'Add viewer' }));
    await screen.findByText('Remove Me');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Permanently remove Remove Me?')).toBeInTheDocument();
    await confirmDialog(user, 'Remove');

    await waitFor(() => expect(screen.queryByText('Remove Me')).not.toBeInTheDocument());
    expect(mocks.portalApi.deleteUser).toHaveBeenCalledWith('viewer-1');
  });

  it('keeps a user when the confirmation dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText('Admin User');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await user.type(screen.getByLabelText('Name'), 'Keep Me');
    await user.type(screen.getByLabelText('Email'), 'keep@example.com');
    await user.click(screen.getByRole('button', { name: 'Add viewer' }));
    await screen.findByText('Keep Me');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await confirmDialog(user, 'Cancel');

    expect(screen.getByText('Keep Me')).toBeInTheDocument();
    expect(mocks.portalApi.deleteUser).not.toHaveBeenCalled();
  });

  it('promotes another user to workspace administrator', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText('Admin User');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await user.type(screen.getByLabelText('Name'), 'New Viewer');
    await user.type(screen.getByLabelText('Email'), 'viewer@example.com');
    await user.click(screen.getByRole('button', { name: 'Add viewer' }));

    await user.click(await screen.findByRole('button', { name: 'Make admin' }));
    await confirmDialog(user, 'Make admin');

    await waitFor(() => expect(mocks.portalApi.updateUser).toHaveBeenCalledWith('viewer-1', { role: 'admin' }));
    await waitFor(() => expect(screen.getAllByText('Workspace administrator', { selector: 'span' })).toHaveLength(2));
  });

  it('approves a pending access request and grants portal access', async () => {
    const user = userEvent.setup();
    mocks.addAccessRequest();
    renderAdmin();

    expect(await screen.findByText('New Comer')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Users, 1 pending access request' })).toBeInTheDocument();
    expect(screen.getByText('“I need the weekly reports.”')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mocks.portalApi.approveAccessRequest).toHaveBeenCalledWith('request-1', { role: 'viewer' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument());
    expect(screen.getAllByText('newcomer@example.com').length).toBeGreaterThan(0);
  });

  it('dismisses an access request after confirmation', async () => {
    const user = userEvent.setup();
    mocks.addAccessRequest();
    renderAdmin();

    await screen.findByText('New Comer');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('Dismiss the request from New Comer?')).toBeInTheDocument();
    await confirmDialog(user, 'Dismiss');

    await waitFor(() => expect(mocks.portalApi.dismissAccessRequest).toHaveBeenCalledWith('request-1'));
    await waitFor(() => expect(screen.queryByText('New Comer')).not.toBeInTheDocument());
  });

  it('opens the publish form on the library tab', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('tab', { name: /Library/ }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeInTheDocument();
    expect(screen.getByText(/Instructions to paste into Cowork/)).toBeInTheDocument();
    expect(screen.getByText('Ships in the container')).toBeInTheDocument();
  });

  it('permanently deletes a live-published report after confirmation', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('tab', { name: /Library/ }));
    await screen.findByText('Live report');
    expect(screen.getByText('Unpublished')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await confirmDialog(user, 'Delete');

    await waitFor(() => expect(screen.queryByText('Live report')).not.toBeInTheDocument());
    expect(mocks.portalApi.deletePublishedArtifact).toHaveBeenCalledWith('artifact-uploaded');
  });

  it('requires both static preflight and the protected preview before publishing the token', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('tab', { name: /Library/ }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.type(screen.getByLabelText('Title'), 'SPC report');
    await user.type(screen.getByLabelText('Description'), 'Watchlist');
    await user.type(screen.getByLabelText('Owner'), 'Operations');
    await user.upload(screen.getByLabelText('HTML or zip'), new File(['<html></html>'], 'watchlist.html', { type: 'text/html' }));

    await screen.findByText('Ready for Launchpad');
    const publish = screen.getByRole('button', { name: 'Publish now' });
    expect(publish).toBeDisabled();
    const frame = screen.getByTitle('Artifact compatibility preview') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { protocol: 'covetrus.portal.preflight', version: 1, type: 'ready' },
    })));
    await waitFor(() => expect(publish).toBeEnabled());
    await user.click(screen.getByRole('radio', { name: 'Pie' }));
    fireEvent.submit(publish.closest('form')!);
    await waitFor(() => expect(mocks.portalApi.publishArtifact).toHaveBeenCalledWith(expect.objectContaining({
      preflightToken: '11111111-1111-4111-8111-111111111111',
      icon: 'pie',
    })));
  });

  it('opens the Qlik editor from a dataset-backed library item', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('tab', { name: /Library/ }));
    expect(screen.queryByLabelText('App ID')).not.toBeInTheDocument();
    expect(screen.getByText('Live report')).toBeInTheDocument();
    const editor = screen.getByRole('link', { name: 'Qlik editor' });
    expect(editor).toHaveAttribute('href', '/admin/artifacts/artifact-1/datasets/report/qlik');
    expect(screen.getByText(/Find a Qlik table/)).toBeInTheDocument();
  });

  it('opens a saved Qlik source from the library row', async () => {
    const user = userEvent.setup();
    mocks.portalApi.getAdminSnapshot.mockResolvedValue({
      users: [mocks.admin], groups: [], memberships: [], grants: [], artifacts: [{
        id: 'artifact-1', slug: 'report', title: 'Operations report', description: 'Report',
        kind: 'report' as const, version: '1.0.0', owner: 'Operations', dataDate: null,
        entryUrl: '/report', capabilities: [], datasetKeys: ['report'], accent: 'teal' as const, source: 'bundled' as const,
      }], datasets: [], qlikConfigured: true, audit: [], accessRequests: [], qlikBindings: [{
        artifactId: 'artifact-1', datasetKey: 'report', appId: '1df4cf94-0a3b-4246-848e-40200247bfba',
        objectId: 'e5c80ad6-3d3a-499c-afc7-d60eb9c4f27b', refreshHourUtc: 8, refreshMinuteUtc: 0, enabled: true,
        lastPulledAt: null, lastError: null, lastRecordCount: null, nextDueAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        transform: { output: 'qlik' as const, keys: 'slug' as const, keepColumns: [] as string[], dropEmptyRows: false, rowFilterMode: 'and' as const, rowFilters: [] },
      }],
    });
    renderAdmin();
    await user.click(screen.getByRole('tab', { name: /Library/ }));
    const editor = screen.getByRole('link', { name: 'Open Qlik editor' });
    expect(editor).toHaveAttribute('href', '/admin/artifacts/artifact-1/datasets/report/qlik');
    expect(screen.queryByLabelText('App ID')).not.toBeInTheDocument();
  });

  it('still shows Qlik editor when a binding exists after HTML replace cleared dataset keys', async () => {
    const user = userEvent.setup();
    mocks.portalApi.getAdminSnapshot.mockResolvedValue({
      users: [mocks.admin], groups: [], memberships: [], grants: [], artifacts: [{
        id: 'artifact-1', slug: 'declining-customer-warning', title: 'Declining Customer Warning', description: 'Report',
        kind: 'report' as const, version: '1.0.1', owner: 'Data Insights', dataDate: null,
        entryUrl: '/artifacts/declining-customer-warning/index.html', capabilities: [], datasetKeys: [] as string[],
        accent: 'teal' as const, source: 'uploaded' as const,
      }], datasets: [], qlikConfigured: true, audit: [], accessRequests: [], qlikBindings: [{
        artifactId: 'artifact-1', datasetKey: 'data', appId: 'd51760fc-8121-4222-b1cf-e3ae6345178a',
        objectId: 'WuPA', refreshHourUtc: 10, refreshMinuteUtc: 0, enabled: true,
        lastPulledAt: null, lastError: null, lastRecordCount: null, nextDueAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        transform: { output: 'qlik' as const, keys: 'slug' as const, keepColumns: [] as string[], dropEmptyRows: false, rowFilterMode: 'and' as const, rowFilters: [] },
      }],
    });
    renderAdmin();
    await user.click(screen.getByRole('tab', { name: /Library/ }));
    expect(screen.getByRole('link', { name: 'Open Qlik editor' })).toBeInTheDocument();
  });
});
