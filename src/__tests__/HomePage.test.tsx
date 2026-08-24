import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomePage } from '@/pages/HomePage';
import type { ArtifactSummary } from '@/types/portal';

const mocks = vi.hoisted(() => ({ catalog: [] as ArtifactSummary[], track: vi.fn(), toggleFavorite: vi.fn(), features: { usageTelemetry: false, usageInsights: false } }));
vi.mock('@/hooks/PortalContext', () => ({ usePortal: () => ({ identity: { displayName: 'Greig Dunbar' }, catalog: mocks.catalog, loading: false, error: null, connect: vi.fn(), toggleFavorite: mocks.toggleFavorite, features: mocks.features }) }));
vi.mock('@/services/usageTelemetry', () => ({ usageTelemetry: { track: mocks.track } }));

function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }

beforeEach(() => { mocks.catalog = []; mocks.track.mockReset(); mocks.toggleFavorite.mockReset(); mocks.features.usageTelemetry = false; });
afterEach(() => vi.useRealTimers());

describe('HomePage routes', () => {
  it('redirects legacy report filters to the dedicated route', async () => {
    render(<MemoryRouter initialEntries={['/?kind=report']}><Routes><Route path="/" element={<HomePage kind="all" />} /><Route path="/reports" element={<Location />} /></Routes></MemoryRouter>);
    expect(await screen.findByTestId('location')).toHaveTextContent('/reports');
  });

  it.each([
    [8, 'Good morning, Greig.'],
    [14, 'Good afternoon, Greig.'],
    [20, 'Good evening, Greig.'],
  ])('uses the browser-local hour for the greeting at %i:00', (hour, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, hour));

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(expected);
  });

  it('refreshes the greeting while the page remains open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 17, 59));
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon, Greig.');

    act(() => vi.advanceTimersByTime(60_000));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good evening, Greig.');
  });

  it.each([
    ['/', 'All'],
    ['/reports', 'Reports'],
    ['/tools', 'Tools'],
  ])('marks the %s library view current', (path, label) => {
    render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/" element={<HomePage kind="all" />} />
      <Route path="/reports" element={<HomePage kind="report" />} />
      <Route path="/tools" element={<HomePage kind="tool" />} />
    </Routes></MemoryRouter>);

    expect(screen.getByRole('navigation', { name: 'Library views' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('prioritises recently used artifacts without duplicating their cards', () => {
    mocks.features.usageTelemetry = true;
    mocks.catalog = [
      { id: 'a1', slug: 'older-report', title: 'Older report', description: 'Used last week', kind: 'report', version: '1.0.0', owner: 'Ops', dataDate: null, entryUrl: '/older', capabilities: [], datasetKeys: [], accent: 'teal', lastOpenedAt: '2026-08-15T10:00:00Z' },
      { id: 'a2', slug: 'recent-report', title: 'Recent report', description: 'Used yesterday', kind: 'report', version: '1.0.0', owner: 'Ops', dataDate: null, entryUrl: '/recent', capabilities: [], datasetKeys: [], accent: 'teal', lastOpenedAt: '2026-08-22T10:00:00Z' },
    ];
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: 'Recently used' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Recent report', 'Older report']);
    expect(screen.getAllByRole('heading', { name: 'Recent report' })).toHaveLength(1);
  });

  it('debounces search telemetry without sending the search text', () => {
    vi.useFakeTimers();
    mocks.catalog = [{ id: 'a1', slug: 'report', title: 'Operations report', description: 'Weekly view', kind: 'report', version: '1.0.0', owner: 'Ops', dataDate: null, entryUrl: '/report', capabilities: [], datasetKeys: [], accent: 'teal' }];
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'Operations' } });
    act(() => vi.advanceTimersByTime(800));
    expect(mocks.track).toHaveBeenCalledWith({ eventType: 'catalog_searched', resultCount: 1, kindFilter: 'all', filterCount: 0 });
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('Operations');
  });
});
