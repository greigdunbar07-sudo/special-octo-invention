import { useState } from 'react';

import logo from '@/assets/covetrus-logo.png';
import { useAuth } from '@/hooks/AuthContext';

const msLogo = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 21 21"
    aria-hidden="true"
  >
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

export function AuthPage() {
  const { signIn, microsoftAuthEnabled } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setError(null);
    setIsLoading(true);

    try {
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in.');
    } finally {
      setIsLoading(false);
    }
  };

  const buttonLabel = isLoading
    ? microsoftAuthEnabled
      ? 'Opening Microsoft sign-in...'
      : 'Signing in...'
    : 'Sign in with Microsoft';

  return (
    <div className="auth-screen">
      {/* Decorative background shapes */}
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />

      <div className="auth-center">
        <div className="auth-card-wrap">
          <div className="auth-card">
            <div className="auth-head">
              <img className="auth-logo" src={logo} alt="Covetrus" />
              <h1 className="auth-title">Launchpad</h1>
              <p className="auth-subtitle">Your secure home for reports and tools.</p>
            </div>

            <button
              type="button"
              onClick={handleSignIn}
              disabled={isLoading}
              className="auth-button"
            >
              {msLogo}
              {buttonLabel}
            </button>

            {error && (
              <p className="auth-error" role="alert">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
