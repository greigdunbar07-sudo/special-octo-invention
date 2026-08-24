import { createRoot } from 'react-dom/client';

import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import { bootstrapAuth } from '@/services/bootstrap';

export function mountPortal(rootElement: HTMLElement) {
  const authService = bootstrapAuth();
  createRoot(rootElement).render(
    <AuthProvider authService={authService}>
      <App />
    </AuthProvider>,
  );
}
