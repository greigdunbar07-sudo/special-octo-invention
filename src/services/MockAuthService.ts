import { type AuthUser, type IAuthService } from './IAuthService';

// Local-dev fixture credentials. The bundled local backend ships without
// App Service Authentication, so this service uses a shared dev account.
// These values only ever reach a developer's local machine — never use
// them in production.
const MOCK_USER = { id: 'local-admin', email: 'dev@contoso.com', name: 'Greig Dunbar' };

/**
 * Local-development auth service. Used when the API URL targets localhost.
 *
 * Uses a memory-only fixture — no Entra wiring or durable session.
 * Production can never select this service because bootstrap requires a
 * localhost API URL.
 */
export class MockAuthService implements IAuthService {
  readonly microsoftAuthEnabled = false;

  async signIn(): Promise<AuthUser> {
    return MOCK_USER;
  }

  async signOut(): Promise<void> {
    // The fixture is deliberately memory-only.
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return MOCK_USER;
  }

  async initializeSession(): Promise<AuthUser | null> {
    return null;
  }
}
