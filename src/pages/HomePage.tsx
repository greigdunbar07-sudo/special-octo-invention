import { ArrowUpRight, CalendarClock, Search, SlidersHorizontal, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import emptyStates from '@/assets/empty-states.svg';
import { usePortal } from '@/hooks/PortalContext';
import { ArtifactIcon } from '@/components/ArtifactIcon';
import { usageTelemetry } from '@/services/usageTelemetry';
import type { ArtifactSummary } from '@/types/portal';

function getGreeting(date = new Date()) {
  const hour = date.getHours();

  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage({ kind: routeKind = 'all' }: { kind?: 'all' | 'report' | 'tool' }) {
  const { identity, catalog, loading, error, connect, toggleFavorite, features = { usageTelemetry: false, usageInsights: false } } = usePortal();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [greeting, setGreeting] = useState(getGreeting);
  const legacyKind = params.get('kind');
  const kind = routeKind;
  const visible = useMemo(() => catalog
    .filter((artifact) => (kind === 'all' || artifact.kind === kind) && `${artifact.title} ${artifact.description} ${artifact.owner}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const favoriteOrder = Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite));
      if (favoriteOrder) return favoriteOrder;
      if (features.usageTelemetry) {
        const recentOrder = String(b.lastOpenedAt ?? '').localeCompare(String(a.lastOpenedAt ?? ''));
        if (recentOrder) return recentOrder;
      }
      return a.title.localeCompare(b.title);
    }), [catalog, features.usageTelemetry, kind, search]);
  const lastSearchEvent = useRef('');

  useEffect(() => {
    const interval = window.setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed.length < 2) { lastSearchEvent.current = ''; return; }
    const signature = `${kind}:${visible.length}`;
    const timer = window.setTimeout(() => {
      if (lastSearchEvent.current === signature) return;
      lastSearchEvent.current = signature;
      usageTelemetry.track({ eventType: 'catalog_searched', resultCount: visible.length, kindFilter: kind, filterCount: kind === 'all' ? 0 : 1 });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [kind, search, visible.length]);

  if (routeKind === 'all' && (legacyKind === 'report' || legacyKind === 'tool')) return <Navigate to={legacyKind === 'report' ? '/reports' : '/tools'} replace />;

  if (loading) return <PageState title="Loading your workspace" body="Checking your portal permissions…" />;
  if (error) return <PageState title="We could not open the portal" body={error} action={<button className="button primary" onClick={() => void connect()}>Connect and retry</button>} />;
  return (
    <>
      <section className="hero-panel">
        <div><p className="eyebrow light">{kind === 'all' ? 'Your workspace' : kind === 'report' ? 'Reporting library' : 'Tool library'}</p><h1>{kind === 'all' ? `${greeting}, ${identity?.displayName.split(' ')[0]}.` : kind === 'report' ? 'Reports' : 'Tools'}</h1><p>{kind === 'all' ? 'Everything you have access to, in one secure place.' : kind === 'report' ? 'Trusted views of the operational data available to you.' : 'Models and utilities available in your workspace.'}</p></div>
        <div className="hero-metric"><strong>{visible.length}</strong><span>{kind === 'all' ? 'Available now' : kind === 'report' ? 'Reports available' : 'Tools available'}</span></div>
      </section>
      <section className="section-heading">
        <div><h2>{kind === 'all' ? 'Reports and tools' : `Available ${kind}s`} <span className="result-count">{visible.length}</span></h2></div>
        <div className="library-controls">
          <label className="search-box"><Search size={17} /><span className="sr-only">Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports and tools" /></label>
          {search && <button className="button clear-search" type="button" onClick={() => setSearch('')}>Clear</button>}
        </div>
      </section>
      <LibraryTabs kind={kind} />
      {visible.length === 0 ? (
        search ? <PageState title="No matches" body="Try a different search term." action={<button className="button" type="button" onClick={() => setSearch('')}>Clear search</button>} />
        : catalog.length === 0 ? <PageState image={emptyStates} title="Your workspace is being set up" body="Reports and tools appear here as soon as they are assigned to you. A portal administrator is usually finishing that step—check back shortly or ask them directly." />
        : <PageState title={kind === 'report' ? 'No reports here yet' : kind === 'tool' ? 'No tools here yet' : 'Nothing here yet'} body="Everything assigned to you lives under the other library tabs. Contact a portal administrator if you believe something is missing." />
      ) : <div className="artifact-grid">{visible.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} toggleFavorite={toggleFavorite} />)}</div>}
      <aside className="security-note"><SlidersHorizontal size={19} /><div><strong>Your library is personalised</strong><p>Access is based on your direct and group assignments. Contact a portal administrator if something is missing.</p></div></aside>
    </>
  );
}

function ArtifactCard({ artifact, toggleFavorite }: { artifact: ArtifactSummary; toggleFavorite: (artifactId: string) => Promise<void> }) {
  return <article className={`artifact-card accent-${artifact.accent}`}><button className={`favorite-button${artifact.isFavorite ? ' favorite-button-active' : ''}`} type="button" aria-label={`${artifact.isFavorite ? 'Remove' : 'Add'} ${artifact.title} ${artifact.isFavorite ? 'from' : 'to'} favourites`} aria-pressed={Boolean(artifact.isFavorite)} title={artifact.isFavorite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void toggleFavorite(artifact.id)}><Star /></button><Link className="artifact-card-link" to={`/artifacts/${artifact.slug}`}>
    <div className="artifact-card-top"><span className="artifact-icon"><ArtifactIcon name={artifact.icon} kind={artifact.kind} /></span><span className="artifact-kind">{artifact.kind}</span><ArrowUpRight className="open-icon" /></div>
    <div className="artifact-card-body"><h3>{artifact.title}</h3><p>{artifact.description}</p></div>
    <dl className="artifact-meta"><div><dt>Owner</dt><dd>{artifact.owner}</dd></div><div><dt>Version</dt><dd>{artifact.version}</dd></div>{(artifact.updatedAt || artifact.publishedAt) && <div><dt><CalendarClock size={13} /> {publicationLabel(artifact.publishedAt, artifact.updatedAt)}</dt><dd>{formatPublicationDate(artifact.updatedAt || artifact.publishedAt!)}</dd></div>}</dl>
  </Link></article>;
}

const LIBRARY_VIEWS = [
  { kind: 'all' as const, to: '/', label: 'All' },
  { kind: 'report' as const, to: '/reports', label: 'Reports' },
  { kind: 'tool' as const, to: '/tools', label: 'Tools' },
];

function LibraryTabs({ kind }: { kind: 'all' | 'report' | 'tool' }) {
  const navigate = useNavigate();
  return (
    <nav className="library-tabs" aria-label="Library views">
      {LIBRARY_VIEWS.map((view, index) => (
        <Link
          key={view.kind}
          id={`library-view-${view.kind}`}
          to={view.to}
          aria-current={kind === view.kind ? 'page' : undefined}
          onKeyDown={(event) => {
            const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? LIBRARY_VIEWS.length - 1 : offset ? (index + offset + LIBRARY_VIEWS.length) % LIBRARY_VIEWS.length : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            const next = LIBRARY_VIEWS[nextIndex];
            navigate(next.to);
            requestAnimationFrame(() => document.getElementById(`library-view-${next.kind}`)?.focus());
          }}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}

function publicationLabel(publishedAt?: string, updatedAt?: string) {
  if (!publishedAt || !updatedAt) return updatedAt ? 'Updated' : 'Published';
  return new Date(updatedAt).getTime() - new Date(publishedAt).getTime() > 1000 ? 'Updated' : 'Published';
}

function formatPublicationDate(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PageState({ title, body, action, image }: { title: string; body: string; action?: React.ReactNode; image?: string }) {
  return <div className="page-state">{image ? <img className="state-illustration" src={image} alt="" /> : <div className="state-mark" />}<h2>{title}</h2><p>{body}</p>{action}</div>;
}
