import * as React from 'react';

import { embeddedArtifacts } from '../generated/embeddedArtifacts';
import styles from './CovetrusPortalPoc.module.scss';
import type { ICovetrusPortalPocProps } from './ICovetrusPortalPocProps';
import { DEMO_DATASETS, type ArtifactDefinition, ARTIFACTS } from './demoData';

type View = { kind: 'library' } | { kind: 'artifact'; artifact: ArtifactDefinition } | { kind: 'admin' };
type ViewerStatus = 'loading' | 'ready' | 'error';

const BRIDGE_PROTOCOL = 'covetrus.portal.bridge';

function ArtifactViewer(props: { artifact: ArtifactDefinition; onBack: () => void }): React.ReactElement {
  const { artifact, onBack } = props;
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const channelRef = React.useRef<MessageChannel | undefined>(undefined);
  const [frameKey, setFrameKey] = React.useState(0);
  const [focusMode, setFocusMode] = React.useState(false);
  const [status, setStatus] = React.useState<ViewerStatus>('loading');
  const [error, setError] = React.useState('');

  const connect = React.useCallback((): void => {
    if (!frameRef.current?.contentWindow) return;
    channelRef.current?.port1.close();
    const channel = new MessageChannel();
    channelRef.current = channel;
    channel.port1.onmessage = (event: MessageEvent): void => {
      const message = event.data as { protocol?: string; version?: number; type?: string; detail?: string };
      if (message?.protocol !== BRIDGE_PROTOCOL || message.version !== 1) return;
      if (message.type === 'ready') {
        channel.port1.postMessage({
          protocol: BRIDGE_PROTOCOL,
          version: 1,
          type: 'init',
          artifactId: artifact.slug,
          datasets: artifact.datasetKeys.map((key) => DEMO_DATASETS[key])
        });
      } else if (message.type === 'initialized') {
        setStatus('ready');
      } else if (message.type === 'error') {
        setError(message.detail || 'The artifact reported an error.');
        setStatus('error');
      }
    };
    channel.port1.start();
    frameRef.current.contentWindow.postMessage(
      { protocol: BRIDGE_PROTOCOL, version: 1, type: 'connect' },
      '*',
      [channel.port2]
    );
  }, [artifact]);

  React.useEffect(() => (): void => channelRef.current?.port1.close(), []);
  React.useEffect(() => {
    if (!focusMode) return undefined;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFocusMode(false);
    };
    document.addEventListener('keydown', close);
    return (): void => document.removeEventListener('keydown', close);
  }, [focusMode]);

  const reload = (): void => {
    setError('');
    setStatus('loading');
    setFrameKey((value) => value + 1);
  };

  return (
    <section className={`${styles.viewer}${focusMode ? ` ${styles.focusMode}` : ''}`}>
      <div className={styles.viewerToolbar}>
        <button className={styles.backButton} onClick={onBack} type="button">← Library</button>
        <div className={styles.viewerTitle}>
          <strong>{artifact.title}</strong>
          <span>{artifact.kind} · version {artifact.version}</span>
        </div>
        <div className={styles.viewerActions}>
          {artifact.capabilities.indexOf('downloads') >= 0 && <span className={styles.capability}>Downloads enabled</span>}
          <button onClick={reload} title="Reload artifact" type="button">↻</button>
          <button onClick={() => setFocusMode((value) => !value)} title={focusMode ? 'Exit focus mode' : 'Open focus mode'} type="button">
            {focusMode ? 'Exit focus' : 'Focus'}
          </button>
        </div>
      </div>
      <div className={styles.frameWrap}>
        {status === 'loading' && <div className={styles.viewerOverlay}><span className={styles.spinner} />Loading demonstration data…</div>}
        {status === 'error' && (
          <div className={`${styles.viewerOverlay} ${styles.viewerError}`}>
            <strong>Artifact unavailable</strong><span>{error}</span><button onClick={reload} type="button">Try again</button>
          </div>
        )}
        <iframe
          key={frameKey}
          ref={frameRef}
          title={artifact.title}
          srcDoc={embeddedArtifacts[artifact.slug]}
          sandbox={`allow-scripts${artifact.capabilities.indexOf('downloads') >= 0 ? ' allow-downloads' : ''}`}
          onLoad={connect}
        />
      </div>
    </section>
  );
}

function AdminDemo(): React.ReactElement {
  const [events, setEvents] = React.useState<string[]>(['Portal demonstration opened']);
  const [operationsEnabled, setOperationsEnabled] = React.useState(true);
  const [commercialEnabled, setCommercialEnabled] = React.useState(true);

  const toggle = (label: string, current: boolean, setter: (value: boolean) => void): void => {
    setter(!current);
    setEvents((items) => [`${label} ${current ? 'disabled' : 'enabled'} (demonstration only)`, ...items]);
  };

  return (
    <div className={styles.adminGrid}>
      <section className={styles.panel}>
        <span className={styles.eyebrow}>Demonstration controls</span>
        <h2>Artifact access</h2>
        <p>These controls are intentionally in memory and reset when the page refreshes.</p>
        <label className={styles.toggleRow}><span><strong>Operations leadership</strong><small>Damages YTD</small></span><input type="checkbox" checked={operationsEnabled} onChange={() => toggle('Operations leadership access', operationsEnabled, setOperationsEnabled)} /></label>
        <label className={styles.toggleRow}><span><strong>Commercial finance</strong><small>3PL opportunity model</small></span><input type="checkbox" checked={commercialEnabled} onChange={() => toggle('Commercial finance access', commercialEnabled, setCommercialEnabled)} /></label>
      </section>
      <section className={styles.panel}>
        <span className={styles.eyebrow}>Session audit</span>
        <h2>Recent events</h2>
        <ul className={styles.auditList}>{events.map((event, index) => <li key={`${event}-${index}`}><span>{event}</span><small>Just now</small></li>)}</ul>
      </section>
    </div>
  );
}

export default function CovetrusPortalPoc(props: ICovetrusPortalPocProps): React.ReactElement<ICovetrusPortalPocProps> {
  const [view, setView] = React.useState<View>({ kind: 'library' });

  if (view.kind === 'artifact') {
    return (
      <div className={styles.covetrusPortalPoc}>
        <div className={styles.demoBanner}>Demonstration data — not for business use</div>
        <ArtifactViewer artifact={view.artifact} onBack={() => setView({ kind: 'library' })} />
      </div>
    );
  }

  return (
    <div className={styles.covetrusPortalPoc}>
      <div className={styles.demoBanner}>Demonstration data — not for business use</div>
      <header className={styles.header}>
        <button className={styles.brand} type="button" onClick={() => setView({ kind: 'library' })} aria-label="Open portal library">
          <span className={styles.brandMark}>C</span><span>Covetrus <b>reports &amp; tools</b></span>
        </button>
        <nav>
          <button className={view.kind === 'library' ? styles.activeNav : ''} type="button" onClick={() => setView({ kind: 'library' })}>Library</button>
          {props.isSiteOwner && <button className={view.kind === 'admin' ? styles.activeNav : ''} type="button" onClick={() => setView({ kind: 'admin' })}>Demo admin</button>}
        </nav>
        <div className={styles.identity}><span>{props.userDisplayName}</span><small>{props.userEmail}</small></div>
      </header>
      <main className={styles.main}>
        {view.kind === 'admin' ? <AdminDemo /> : (
          <>
            <section className={styles.hero}>
              <span className={styles.eyebrow}>Internal workspace</span>
              <h1>Your reports and tools, together.</h1>
              <p>This SharePoint proof of concept uses your existing Microsoft 365 session and keeps each artifact isolated.</p>
            </section>
            <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Assigned to you</span><h2>Library</h2></div><span>{ARTIFACTS.length} artifacts</span></div>
            <section className={styles.cardGrid}>
              {ARTIFACTS.map((artifact) => (
                <button className={`${styles.card} ${artifact.accent === 'teal' ? styles.tealCard : styles.blueCard}`} key={artifact.slug} type="button" onClick={() => setView({ kind: 'artifact', artifact })}>
                  <span className={styles.cardKind}>{artifact.kind}</span>
                  <span className={styles.cardIcon}>{artifact.kind === 'report' ? '↗' : '◆'}</span>
                  <strong>{artifact.title}</strong>
                  <p>{artifact.description}</p>
                  <span className={styles.cardMeta}>{artifact.owner} · {artifact.dataDate}</span>
                  <span className={styles.openLabel}>Open {artifact.kind} →</span>
                </button>
              ))}
            </section>
          </>
        )}
      </main>
      <footer>SharePoint proof of concept · No operational data is included</footer>
    </div>
  );
}
