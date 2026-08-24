import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PortalShell } from '@/components/PortalShell';

const mocks = vi.hoisted(() => ({
  identity: { id: 'u1', tenantId: 't1', entraObjectId: 'e1', email: 'admin@example.com', displayName: 'Admin User', role: 'admin' as const, status: 'active' as const, hasCompletedTour: true },
  catalog: [{ id: 'a1', slug: 'damages-ytd', title: 'Damages YTD', description: '', kind: 'report' as const, version: '1', owner: 'Ops', dataDate: null, entryUrl: '', capabilities: [], datasetKeys: ['damages'], accent: 'teal' as const }],
}));

vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('@/hooks/PortalContext', () => ({ usePortal: () => ({
  identity: mocks.identity, catalog: mocks.catalog,
  notifications: { items: [], unreadCount: 0 }, notificationsLoading: false, notificationsError: null,
  markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn(),
  completeOnboarding: vi.fn().mockResolvedValue(undefined),
}) }));

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<PortalShell />}><Route path="*" element={<div>Page</div>} /></Route></Routes></MemoryRouter>);
}

describe('PortalShell navigation', () => {
  afterEach(() => {
    mocks.identity.hasCompletedTour = true;
    window.localStorage.clear();
  });

  it('opens the welcome tour for a first-time user', async () => {
    mocks.identity.hasCompletedTour = false;
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Welcome to Covetrus Launchpad, Admin.' })).toBeInTheDocument();
  });

  it.each([
    ['/', 'Library'], ['/reports', 'Library'], ['/tools', 'Library'], ['/admin', 'Admin'], ['/artifacts/damages-ytd', 'Library'],
  ])('marks one section current at %s', (path, label) => {
    renderAt(path);
    const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(label);
  });

  it('keeps Reports and Tools out of the sidebar and drops the Microsoft badge', () => {
    renderAt('/');
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tools' })).not.toBeInTheDocument();
    expect(screen.queryByText('Microsoft protected')).not.toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '164');
  });

  it('resizes the desktop sidebar with the keyboard and persists the width', () => {
    renderAt('/');
    const resizer = screen.getByRole('separator', { name: 'Resize sidebar' });
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(resizer).toHaveAttribute('aria-valuenow', '172');
    expect(document.querySelector('.portal-layout')).toHaveStyle({ '--sidebar': '172px' });
    expect(window.localStorage.getItem('covetrus.portal.sidebar-width')).toBe('172');
  });

  it('titles the Qlik query editor and hides portal chrome', () => {
    renderAt('/admin/artifacts/a1/datasets/report/qlik');
    expect(screen.getByText('Qlik query editor')).toBeInTheDocument();
    expect(document.querySelector('.portal-layout')).toHaveClass('qlik-editor-open');
  });

  it('renders a new-tab artifact without the portal chrome', () => {
    renderAt('/artifacts/damages-ytd?view=tab');

    expect(screen.getByText('Page')).toBeInTheDocument();
    expect(document.querySelector('.standalone-artifact')).toBeInTheDocument();
    expect(document.querySelector('.portal-layout')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
  });

  it('gives an embedded artifact viewer the full remaining portal width', () => {
    renderAt('/artifacts/damages-ytd');
    expect(document.querySelector('#main-content')).toHaveClass('viewer-content');
  });
});
