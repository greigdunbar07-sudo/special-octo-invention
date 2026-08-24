import { ChevronDown, Compass, Grid2X2, LogOut, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import logo from '@/assets/covetrus-logo.png';
import logoMark from '@/assets/covetrus-mark.png';
import { NotificationCenter } from '@/components/NotificationCenter';
import { WelcomeTour } from '@/components/WelcomeTour';
import { useAuth } from '@/hooks/AuthContext';
import { usePortal } from '@/hooks/PortalContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { AccessRequiredPage } from '@/pages/AccessRequiredPage';

export function PortalShell() {
  const { signOut } = useAuth();
  const { identity, completeOnboarding, loading, errorCode } = usePortal();
  const { pathname, search } = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const account = useRef<HTMLDivElement>(null);
  const promptedUser = useRef<string | null>(null);
  useFocusTrap(account, accountOpen);

  const qlikEditor = pathname.includes('/qlik');
  const standaloneArtifact = pathname.startsWith('/artifacts/') && new URLSearchParams(search).get('view') === 'tab';
  const section = pathname.startsWith('/admin') ? 'admin' : 'library';
  const pageTitle = qlikEditor ? 'Qlik query editor' : pathname === '/admin' || pathname.startsWith('/admin?') ? 'Administration' : pathname.startsWith('/artifacts/') ? 'Artifact viewer' : 'Library';

  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: PointerEvent) => { if (!account.current?.contains(event.target as Node)) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);

  useEffect(() => {
    if (standaloneArtifact || identity?.hasCompletedTour !== false || promptedUser.current === identity.id) return;
    promptedUser.current = identity.id;
    setTourOpen(true);
  }, [identity, standaloneArtifact]);

  // A signed-in Microsoft identity without a portal account gets a dedicated
  // self-service page instead of the generic library error.
  if (!loading && !identity && (errorCode === 'PORTAL_ACCESS_REQUIRED' || errorCode === 'USER_DISABLED')) {
    return <AccessRequiredPage code={errorCode} />;
  }

  if (standaloneArtifact) return <main className="standalone-artifact"><Outlet /></main>;

  return <div className={`portal-layout${qlikEditor ? ' qlik-editor-open' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <Link className="brand-lockup" to="/" aria-label="Covetrus Launchpad home">
        <img className="brand-logo-mark" src={logoMark} alt="" />
        <span className="brand-product">Launchpad</span>
      </Link>
      <nav className="primary-nav" aria-label="Primary navigation">
        <Link to="/" className={`nav-link${section === 'library' ? ' nav-link-active' : ''}`} aria-current={section === 'library' ? 'page' : undefined}><Grid2X2 size={18} /><span className="nav-label">Library</span></Link>
      </nav>
      {identity?.role === 'admin' && <div className="sidebar-footer">
        <Link to="/admin" className={`nav-link${section === 'admin' ? ' nav-link-active' : ''}`} aria-current={section === 'admin' ? 'page' : undefined}><Settings size={18} /><span className="nav-label mobile-short-label" data-short="Admin">Admin</span></Link>
      </div>}
    </aside>
    <div className="portal-main">
      <header className="topbar">
        <div className="topbar-context">
          <img className="mobile-brand" src={logo} alt="Covetrus" />
          <div><span className="eyebrow">Internal workspace</span><strong>{pageTitle}</strong></div>
        </div>
        <div className="topbar-actions">
          <NotificationCenter />
          <div className="account-menu" ref={account}>
            <button className="profile-button" type="button" aria-label={`Account for ${identity?.displayName || 'signed-in user'}`} aria-expanded={accountOpen} aria-controls="account-panel" onClick={() => setAccountOpen((value) => !value)}>
              <span className="avatar">{(identity?.displayName || 'U').split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
              <span className="profile-copy"><strong>{identity?.displayName || 'Signed-in user'}</strong><small>{identity?.email}</small></span>
              <ChevronDown className="profile-chevron" size={15} />
            </button>
            {accountOpen && <section id="account-panel" className="account-panel" role="dialog" aria-label="Account">
              <div className="account-identity"><span className="avatar large">{(identity?.displayName || 'U').split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><strong>{identity?.displayName}</strong><span>{identity?.email}</span><small>{identity?.role === 'admin' ? 'Workspace administrator' : 'Viewer'}</small></div></div>
              <button type="button" className="account-action" onClick={() => { setAccountOpen(false); setTourOpen(true); }}><Compass size={17} /> Take the Launchpad tour</button>
              <button type="button" className="account-action" onClick={() => { setAccountOpen(false); void signOut(); }}><LogOut size={17} /> Sign out</button>
            </section>}
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="content"><Outlet /></main>
    </div>
    <WelcomeTour open={tourOpen} displayName={identity?.displayName ?? ''} onFinish={async () => { if (identity?.hasCompletedTour === false) await completeOnboarding(); setTourOpen(false); }} />
  </div>;
}
