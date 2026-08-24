import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { PortalShell } from '@/components/PortalShell';
import { useAuth } from '@/hooks/AuthContext';
import { PortalProvider } from '@/hooks/PortalContext';
import { ToastProvider } from '@/hooks/ToastContext';
import { AdminPage } from '@/pages/AdminPage';
import { ArtifactPage } from '@/pages/ArtifactPage';
import { HomePage } from '@/pages/HomePage';
import { QlikQueryPage } from '@/pages/QlikQueryPage';

function AuthGuard({
  children,
  requireAuth,
}: {
  children: React.ReactNode;
  requireAuth: boolean;
}) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="launchpad-loading" role="status"><span className="spinner" /> Opening Covetrus Launchpad…</div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          {/* ensure all new routes require auth */}
          <Routes>
            <Route
              path="/auth"
              element={
                <AuthGuard requireAuth={false}>
                  <AuthPage />
                </AuthGuard>
              }
            />
            <Route path="/" element={<AuthGuard requireAuth={true}><PortalProvider><PortalShell /></PortalProvider></AuthGuard>}>
              <Route index element={<HomePage kind="all" />} />
              <Route path="reports" element={<HomePage kind="report" />} />
              <Route path="tools" element={<HomePage kind="tool" />} />
              <Route path="artifacts/:artifactId" element={<ArtifactPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="admin/artifacts/:artifactId/datasets/:datasetKey/qlik" element={<QlikQueryPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
