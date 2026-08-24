import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { NotificationCenter } from '@/components/NotificationCenter';
import type { NotificationFeed } from '@/types/portal';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => {}), markAll: vi.fn(async () => {}),
  feed: {
    items: [{ id: 'n1', type: 'dataset_refreshed', artifactId: 'a1', artifactSlug: 'damages-ytd', artifactTitle: 'Damages YTD', artifactKind: 'report', datasetKey: 'damages', subjectLabel: null, generatedAt: '2026-08-20T10:00:00Z', createdAt: '2026-08-20T10:00:00Z', readAt: null }],
    unreadCount: 1,
  } as NotificationFeed,
}));

vi.mock('@/hooks/PortalContext', () => ({ usePortal: () => ({
  notifications: mocks.feed, notificationsLoading: false, notificationsError: null,
  markNotificationRead: mocks.markRead, markAllNotificationsRead: mocks.markAll,
}) }));

describe('NotificationCenter', () => {
  it('shows unread refreshes and opens the relevant artifact', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Routes><Route path="*" element={<><NotificationCenter /><span data-testid="path">path</span></>} /></Routes></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Damages YTD/ }));
    expect(mocks.markRead).toHaveBeenCalledWith('n1');
  });

  it('marks all visible notifications as read', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><NotificationCenter /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(mocks.markAll).toHaveBeenCalledOnce();
  });

  it('renders per-type copy and filters to unread items', async () => {
    const original = mocks.feed;
    mocks.feed = {
      items: [
        { id: 'n1', type: 'access_requested', artifactId: null, artifactSlug: null, artifactTitle: null, artifactKind: null, datasetKey: null, subjectLabel: 'New Comer', generatedAt: '2026-08-20T10:00:00Z', createdAt: '2026-08-20T10:00:00Z', readAt: null },
        { id: 'n2', type: 'access_granted', artifactId: 'a1', artifactSlug: 'damages-ytd', artifactTitle: 'Damages YTD', artifactKind: 'report', datasetKey: null, subjectLabel: null, generatedAt: '2026-08-19T10:00:00Z', createdAt: '2026-08-19T10:00:00Z', readAt: '2026-08-19T11:00:00Z' },
      ],
      unreadCount: 1,
    } as NotificationFeed;
    try {
      const user = userEvent.setup();
      render(<MemoryRouter><NotificationCenter /></MemoryRouter>);
      await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));

      expect(screen.getByText('Requested portal access')).toBeInTheDocument();
      expect(screen.getByText('You now have access')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^Unread/ }));
      expect(screen.getByText('New Comer')).toBeInTheDocument();
      expect(screen.queryByText('Damages YTD')).not.toBeInTheDocument();
    } finally {
      mocks.feed = original;
    }
  });
});
