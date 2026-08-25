import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtifactPage } from '@/pages/ArtifactPage';
import { portalApi } from '@/services/portalApi';
import type { ArtifactSummary } from '@/types/portal';

const mocks = vi.hoisted(() => ({ openArtifactInNewTab: vi.fn(), track: vi.fn() }));

const artifact: ArtifactSummary = {
  id: 'a1', slug: 'self-contained', title: 'Self contained', description: 'Demo',
  kind: 'report', version: '1.0.0', owner: 'Operations', dataDate: null,
  entryUrl: '/artifacts/self-contained/index.html', capabilities: [], datasetKeys: [],
  accent: 'teal', source: 'uploaded', hostedHtml: '<html><body>ready</body></html>',
};

const priceAudit: ArtifactSummary = {
  ...artifact,
  id: 'a2', slug: 'price-audit', title: 'Price Audit', datasetKeys: ['data'],
  entryUrl: '/artifacts/price-audit/index.html', hostedHtml: '<html><body>price</body></html>',
};

const betterBuying: ArtifactSummary = {
  id: 'a3', slug: 'better-buying', title: 'Better Buying', description: 'Supplier buying workspace',
  kind: 'tool', version: '1.0.0', owner: 'Commercial', dataDate: null,
  entryUrl: 'https://covetrus-better-buying.azurewebsites.net/', capabilities: [], datasetKeys: [],
  accent: 'blue', source: 'linked',
};

vi.mock('@/hooks/PortalContext', () => ({
  usePortal: () => ({ catalog: [artifact, priceAudit, betterBuying], loading: false }),
}));
vi.mock('@/services/portalApi', () => ({
  portalApi: { getArtifactData: vi.fn() },
}));
vi.mock('@/services/artifactNewTab', () => ({
  openArtifactInNewTab: mocks.openArtifactInNewTab,
}));
vi.mock('@/services/usageTelemetry', () => ({ usageTelemetry: { track: mocks.track } }));

describe('ArtifactPage self-contained viewer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records an authorised artifact load attempt without content details', async () => {
    render(<MemoryRouter initialEntries={['/artifacts/self-contained']}><Routes><Route path="/artifacts/:artifactId" element={<ArtifactPage />} /></Routes></MemoryRouter>);
    await screen.findByTitle('Self contained');
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'artifact_opened', artifactId: 'a1', interactionId: expect.any(String) }));
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('ready</body>');
  });

  it('does not wait for protected data when no datasets are declared', async () => {
    render(<MemoryRouter initialEntries={['/artifacts/self-contained']}><Routes><Route path="/artifacts/:artifactId" element={<ArtifactPage />} /></Routes></MemoryRouter>);
    const frame = await screen.findByTitle('Self contained');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
    expect(screen.queryByText('Loading protected data…')).not.toBeInTheDocument();
  });

  it('opens the sandboxed portal viewer in a new tab', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/artifacts/self-contained']}><Routes><Route path="/artifacts/:artifactId" element={<ArtifactPage />} /></Routes></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Open securely in a new tab' }));

    expect(mocks.openArtifactInNewTab).toHaveBeenCalledWith(artifact.slug);
  });

  it('shows only the report frame in new-tab mode', async () => {
    render(<MemoryRouter initialEntries={['/artifacts/self-contained?view=tab']}><Routes><Route path="/artifacts/:artifactId" element={<ArtifactPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByTitle('Self contained')).toBeInTheDocument();
    expect(document.querySelector('.viewer-page')).toHaveClass('viewer-standalone');
    expect(screen.queryByRole('button', { name: 'Reload artifact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('starts loading protected datasets before the iframe asks for them', async () => {
    vi.mocked(portalApi.getArtifactData).mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter initialEntries={['/artifacts/price-audit']}><Routes><Route path="/artifacts/:artifactId" element={<ArtifactPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Loading protected data…')).toBeInTheDocument();
    expect(portalApi.getArtifactData).toHaveBeenCalledWith('a2', 'data');
  });

  it('opens a linked app in a new tab without mounting an artifact iframe', async () => {
    const user = userEvent.setup();
    const opened = { opener: window as Window | null };
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    render(<MemoryRouter initialEntries={['/artifacts/better-buying']}><Routes><Route path="/artifacts/:artifactId" element={<ArtifactPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Better Buying' })).toBeInTheDocument();
    expect(screen.queryByTitle('Better Buying')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'artifact_opened', artifactId: 'a3' }));

    await user.click(screen.getByRole('button', { name: 'Open Better Buying' }));

    expect(open).toHaveBeenCalledWith('https://covetrus-better-buying.azurewebsites.net/', '_blank', 'noopener,noreferrer');
    expect(opened.opener).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'artifact_ready', artifactId: 'a3', interactionId: expect.any(String) }));
    open.mockRestore();
  });
});
