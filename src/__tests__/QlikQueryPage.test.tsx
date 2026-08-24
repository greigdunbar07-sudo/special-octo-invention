import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '@/components/ConfirmDialog';
import { QlikQueryPage } from '@/pages/QlikQueryPage';
import type { PortalIdentity, QlikPreviewSample } from '@/types/portal';

const appId = '1df4cf94-0a3b-4246-848e-40200247bfba';
const sample: QlikPreviewSample = {
  appId, objectId: 'WuPA',
  columns: [
    { key: 'product', title: 'Product', role: 'dimension' },
    { key: 'list-price', title: 'List Price', role: 'measure' },
    { key: 'unused', title: 'Unused', role: 'dimension' },
  ],
  rows: [['Apoquel', 12.5, 'extra'], ['Rimadyl', 40, 'extra']],
  sourceRowCount: 2, truncated: false,
};
const mocks = vi.hoisted(() => {
  const admin: PortalIdentity = {
    id: 'admin-1', tenantId: 'tenant-1', entraObjectId: 'entra-1',
    email: 'admin@example.com', displayName: 'Admin User', role: 'admin', status: 'active',
  };
  return {
    admin,
    portalApi: {
      getQlikBindingContext: vi.fn(),
      listQlikApps: vi.fn(),
      listQlikTables: vi.fn(),
      previewQlikTable: vi.fn(),
      saveQlikBinding: vi.fn(),
      pullQlikBinding: vi.fn(),
      deleteQlikBinding: vi.fn(),
    },
  };
});

vi.mock('@/hooks/PortalContext', () => ({
  usePortal: () => ({ identity: mocks.admin, loading: false }),
}));
vi.mock('@/services/portalApi', () => ({ portalApi: mocks.portalApi }));

function renderEditor() {
  render(
    <MemoryRouter initialEntries={['/admin/artifacts/artifact-1/datasets/report/qlik']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/admin/artifacts/:artifactId/datasets/:datasetKey/qlik" element={<QlikQueryPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe('Qlik query editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.portalApi.getQlikBindingContext.mockResolvedValue({
      artifact: {
        id: 'artifact-1', slug: 'report', title: 'Operations report', description: 'Report',
        kind: 'report', version: '1.0.0', owner: 'Operations', dataDate: null,
        entryUrl: '/report', capabilities: [], datasetKeys: ['report'], accent: 'teal', source: 'bundled',
      },
      binding: null,
      qlikConfigured: true,
    });
    mocks.portalApi.previewQlikTable.mockResolvedValue(sample);
    mocks.portalApi.saveQlikBinding.mockImplementation(async (_artifactId: string, datasetKey: string, input: { appId: string; objectId: string; transform: { keepColumns: string[] } }) => ({
      artifactId: 'artifact-1', datasetKey, appId: input.appId, objectId: input.objectId,
      refreshHourUtc: 8, refreshMinuteUtc: 0, enabled: true,
      lastPulledAt: null, lastError: null, lastRecordCount: null,
      nextDueAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      transform: { output: 'qlik', keys: 'slug', keepColumns: input.transform.keepColumns, dropEmptyRows: false, rowFilterMode: 'and', rowFilters: [] },
    }));
  });

  it('lets an admin paste IDs, hide a column, and save the recipe', async () => {
    const user = userEvent.setup();
    renderEditor();

    const openSource = screen.queryByRole('button', { name: 'Source' });
    if (openSource) await user.click(openSource);
    await user.type(await screen.findByLabelText('App ID'), appId);
    await user.type(screen.getByLabelText('Object ID'), 'WuPA');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('Apoquel');
    expect(screen.getByRole('columnheader', { name: /List Price/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide Unused' }));
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() => expect(mocks.portalApi.saveQlikBinding).toHaveBeenCalledWith('artifact-1', 'report', expect.objectContaining({
      appId, objectId: 'WuPA',
      transform: expect.objectContaining({ keepColumns: ['Product', 'List Price'] }),
    })));
    expect(mocks.portalApi.previewQlikTable).toHaveBeenCalledWith({ appId, objectId: 'WuPA' });
    expect(mocks.portalApi.listQlikApps).not.toHaveBeenCalled();
    expect(mocks.portalApi.listQlikTables).not.toHaveBeenCalled();
  });

  it('does not browse Qlik apps or tables', async () => {
    renderEditor();
    expect(screen.queryByLabelText('Search Qlik apps')).not.toBeInTheDocument();
    expect(screen.queryByText('Navigator')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('App ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Object ID')).toBeInTheDocument();
    expect(mocks.portalApi.listQlikApps).not.toHaveBeenCalled();
    expect(mocks.portalApi.listQlikTables).not.toHaveBeenCalled();
  });
});
