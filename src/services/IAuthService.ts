/** Trimmed view of the authenticated user shown in the UI. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Auth service contract used by the React layer.
 *
 * Two implementations ship with this template:
 *
 * - MockAuthService — local development fixture.
 * - AppServiceAuthService — production Microsoft Entra session supplied by
 *   Azure App Service Authentication.
 *
 * `bootstrapAuth()` picks the right one from the Vite build mode.
 */
export interface IAuthService {
  /**
   * True when this service requires Microsoft Entra interactive sign-in.
   * The AuthPage uses this to choose its loading-state label.
   */
  readonly microsoftAuthEnabled: boolean;

  /**
   * Acquire a session interactively through the hosting platform.
   */
  signIn(): Promise<AuthUser>;

  signOut(): Promise<void>;

  /** Return the current session's user, or `null` if not signed in. */
  getCurrentUser(): Promise<AuthUser | null>;

  /**
   * Read the hosting platform session without opening interactive UI.
   */
  initializeSession(): Promise<AuthUser | null>;
}

/** Map the raw session user shape to the trimmed view used in the UI. */
export function toAuthUser(user: {
  id: string;
  email: string;
  name?: string;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name || user.email.split('@')[0],
  };
}
