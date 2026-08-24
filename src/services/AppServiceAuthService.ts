import type { AuthUser, IAuthService } from './IAuthService';

export class AppServiceAuthService implements IAuthService {
  readonly microsoftAuthEnabled = true;

  async signIn(): Promise<AuthUser> {
    window.location.assign('/.auth/login/aad?post_login_redirect_uri=/');
    return new Promise<AuthUser>(() => undefined);
  }

  async signOut(): Promise<void> {
    window.location.assign('/.auth/logout?post_logout_redirect_uri=/');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('The Microsoft session could not be read.');
    return response.json() as Promise<AuthUser>;
  }

  async initializeSession(): Promise<AuthUser | null> {
    return this.getCurrentUser();
  }
}
