import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessRequiredPage } from '@/pages/AccessRequiredPage';
import type { AccessRequestRecord } from '@/types/portal';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  refresh: vi.fn(),
  portalApi: {
    getMyAccessRequest: vi.fn<() => Promise<AccessRequestRecord | null>>(async () => null),
    submitAccessRequest: vi.fn(async (note: string): Promise<AccessRequestRecord> => ({
      id: 'request-1', email: 'newcomer@example.com', displayName: 'New Comer', note,
      status: 'requested', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })),
  },
}));

vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'entra-2', email: 'newcomer@example.com', name: 'New Comer' }, signOut: mocks.signOut }),
}));
vi.mock('@/hooks/PortalContext', () => ({
  usePortal: () => ({ refresh: mocks.refresh, loading: false }),
}));
vi.mock('@/services/portalApi', () => ({ portalApi: mocks.portalApi }));

describe('AccessRequiredPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.portalApi.getMyAccessRequest.mockResolvedValue(null);
  });

  it('lets an unprovisioned user submit an access request with a note', async () => {
    const user = userEvent.setup();
    render(<AccessRequiredPage code="PORTAL_ACCESS_REQUIRED" />);

    expect(screen.getByRole('heading', { name: 'Almost there' })).toBeInTheDocument();
    expect(screen.getByText('newcomer@example.com')).toBeInTheDocument();

    await user.type(await screen.findByLabelText(/Why do you need access/), 'I need the weekly operations reports.');
    await user.click(screen.getByRole('button', { name: 'Request access' }));

    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    expect(mocks.portalApi.submitAccessRequest).toHaveBeenCalledWith('I need the weekly operations reports.');
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
  });

  it('shows the submitted state when a request already exists', async () => {
    mocks.portalApi.getMyAccessRequest.mockResolvedValue({
      id: 'request-1', email: 'newcomer@example.com', displayName: 'New Comer', note: '',
      status: 'requested', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    render(<AccessRequiredPage code="PORTAL_ACCESS_REQUIRED" />);

    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
  });

  it('uses distinct copy for a disabled account and offers sign-out', async () => {
    const user = userEvent.setup();
    render(<AccessRequiredPage code="USER_DISABLED" />);

    expect(await screen.findByRole('heading', { name: 'Your access is on hold' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sign out and use a different account/ }));
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it('re-checks portal access on demand', async () => {
    const user = userEvent.setup();
    render(<AccessRequiredPage code="PORTAL_ACCESS_REQUIRED" />);

    await screen.findByRole('button', { name: 'Request access' });
    await user.click(screen.getByRole('button', { name: /Check again/ }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
});
