import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import type { IAuthService } from '@/services/IAuthService';

const signedOut: IAuthService = {
  microsoftAuthEnabled: true,
  async initializeSession() { return null; },
  async getCurrentUser() { return null; },
  async signIn() { return { id: 'u1', email: 'user@covetrus.com', name: 'User' }; },
  async signOut() {},
};

describe('first visit authentication', () => {
  it('takes a signed-out visitor at the root directly to the Launchpad auth page', async () => {
    window.history.replaceState({}, '', '/');
    render(<AuthProvider authService={signedOut}><App /></AuthProvider>);

    expect(await screen.findByRole('heading', { name: 'Launchpad' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/auth');
  });
});
