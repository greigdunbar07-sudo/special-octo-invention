import { ArrowLeft, Download, ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import { PageState } from './HomePage';
import { usePortal } from '@/hooks/PortalContext';
import { portalApi } from '@/services/portalApi';
import { BRIDGE_PROTOCOL, isArtifactBridgeMessage, saveArtifactDownload } from '@/services/artifactBridge';
import { openArtifactInNewTab } from '@/services/artifactNewTab';
import { usageTelemetry } from '@/services/usageTelemetry';
import type { ArtifactFailureCode, DatasetEnvelope } from '@/types/portal';

type BridgeDataset = { datasetKey: string; schemaVersion: number; payload: unknown; payloadJson: string };

function toBridgeDatasets(envelopes: DatasetEnvelope[]): BridgeDataset[] {
  return envelopes.map((envelope) => ({
    datasetKey: envelope.datasetKey,
    schemaVersion: envelope.schemaVersion,
    payload: envelope.payload,
    payloadJson: JSON.stringify(envelope.payload),
  }));
}

export function ArtifactPage() {
  const { artifactId = '' } = useParams();
  const { search } = useLocation();
  const standalone = new URLSearchParams(search).get('view') === 'tab';
  const { catalog, loading: portalLoading, markArtifactUsed } = usePortal();
  const artifact = catalog.find((item) => item.slug === artifactId);
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useRef<MessageChannel | null>(null);
  const datasetsRef = useRef<Promise<BridgeDataset[]> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [newTabError, setNewTabError] = useState('');
  const [downloadNotice, setDownloadNotice] = useState('');
  const downloadNoticeTimer = useRef<number | null>(null);
  const attempt = useRef<{ key: string; interactionId: string; startedAt: number; terminal: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!artifact) return;
    const key = `${artifact.id}:${frameKey}`;
    if (attempt.current?.key === key) return;
    setError(''); setStatus('loading');
    attempt.current = { key, interactionId: crypto.randomUUID(), startedAt: performance.now(), terminal: false };
    usageTelemetry.track({ eventType: 'artifact_opened', artifactId: artifact.id, interactionId: attempt.current.interactionId });
  }, [artifact, frameKey]);

  const finishAttempt = useCallback((result: 'ready' | 'failed', errorCode?: ArtifactFailureCode) => {
    const current = attempt.current;
    if (!artifact || !current || current.terminal) return;
    current.terminal = true;
    const durationMs = Math.max(0, Math.round(performance.now() - current.startedAt));
    if (result === 'ready') { markArtifactUsed?.(artifact.id); usageTelemetry.track({ eventType: 'artifact_ready', artifactId: artifact.id, interactionId: current.interactionId, durationMs }); }
    else usageTelemetry.track({ eventType: 'artifact_failed', artifactId: artifact.id, interactionId: current.interactionId, durationMs, errorCode: errorCode! });
  }, [artifact, markArtifactUsed]);

  useEffect(() => {
    if (!artifact) return;
    if (artifact.datasetKeys.length === 0) {
      datasetsRef.current = Promise.resolve([]);
      return;
    }
    datasetsRef.current = Promise.all(artifact.datasetKeys.map((key) => portalApi.getArtifactData(artifact.id, key))).then(toBridgeDatasets);
  }, [artifact, frameKey]);

  const connect = useCallback(() => {
    if (!artifact || !frame.current?.contentWindow) return;
    if (artifact.datasetKeys.length === 0) { setStatus('ready'); finishAttempt('ready'); }
    channel.current?.port1.close();
    const next = new MessageChannel(); channel.current = next;
    next.port1.onmessage = async (event: MessageEvent) => {
      const message = event.data;
      if (!isArtifactBridgeMessage(message)) return;
      if (message.type === 'download') {
        if (!artifact.capabilities.includes('downloads')) return;
        try {
          saveArtifactDownload(message);
          setDownloadNotice(`Download started: ${message.filename}`);
          if (downloadNoticeTimer.current) window.clearTimeout(downloadNoticeTimer.current);
          downloadNoticeTimer.current = window.setTimeout(() => setDownloadNotice(''), 4_000);
        }
        catch { setError('The generated file could not be downloaded safely.'); setStatus('error'); finishAttempt('failed', 'ARTIFACT_REPORTED_ERROR'); }
        return;
      }
      if (message.type === 'ready') {
        try {
          const datasets = await (datasetsRef.current ?? Promise.resolve([]));
          next.port1.postMessage({ protocol: BRIDGE_PROTOCOL, version: 1, type: 'init', artifactId: artifact.slug, datasets });
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Data could not be loaded.'); setStatus('error'); finishAttempt('failed', 'DATASET_LOAD_FAILED'); }
      }
      if (message.type === 'initialized') { setStatus('ready'); finishAttempt('ready'); }
      if (message.type === 'error') { setError(message.detail || 'The artifact reported an error.'); setStatus('error'); finishAttempt('failed', 'ARTIFACT_REPORTED_ERROR'); }
    };
    next.port1.start();
    frame.current.contentWindow.postMessage({ protocol: BRIDGE_PROTOCOL, version: 1, type: 'connect' }, '*', [next.port2]);
  }, [artifact, finishAttempt]);

  useEffect(() => {
    if (!artifact || status !== 'loading') return;
    const timer = window.setTimeout(() => {
      setError('The artifact did not finish loading.'); setStatus('error'); finishAttempt('failed', 'INITIALIZATION_TIMEOUT');
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [artifact, finishAttempt, frameKey, status]);

  useEffect(() => () => {
    channel.current?.port1.close();
    if (downloadNoticeTimer.current) window.clearTimeout(downloadNoticeTimer.current);
  }, []);
  useEffect(() => {
    if (!focusMode) return;
    const previousOverflow = document.body.style.overflow;
    const exit = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocusMode(false); };
    document.body.style.overflow = 'hidden'; document.addEventListener('keydown', exit);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', exit); };
  }, [focusMode]);
  if (portalLoading) return <PageState title="Opening artifact" body="Checking access…" />;
  if (!artifact) return <PageState title="Access denied" body="This artifact does not exist or is not assigned to you." action={<Link className="button primary" to="/">Return to library</Link>} />;
  const categoryPath = artifact.kind === 'report' ? '/reports' : '/tools';
  const categoryLabel = artifact.kind === 'report' ? 'Reports' : 'Tools';
  return <div className={`viewer-page${focusMode ? ' viewer-focus-mode' : ''}${standalone ? ' viewer-standalone' : ''}`}>
    {!standalone && <div className="viewer-toolbar">
      <div className="viewer-breadcrumb"><Link to={categoryPath}><ArrowLeft size={17} /> {categoryLabel}</Link><span>/</span><div><strong>{artifact.title}</strong><small>{artifact.kind} · version {artifact.version}</small></div></div>
      <div className="viewer-actions">{artifact.capabilities.includes('downloads') && <span className="capability"><Download size={15} /> Downloads enabled</span>}<button type="button" aria-label="Reload artifact" title="Reload" onClick={() => { setError(''); setStatus('loading'); setFrameKey((value) => value + 1); }}><RefreshCw size={17} /></button><button type="button" aria-label={focusMode ? 'Exit focus mode' : 'Open focus mode'} title={focusMode ? 'Exit focus mode' : 'Open focus mode'} aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>{focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button type="button" aria-label="Open securely in a new tab" title="Open securely in a new tab" onClick={() => { try { setNewTabError(''); openArtifactInNewTab(artifact.slug); } catch (caught) { setNewTabError(caught instanceof Error ? caught.message : 'The new tab could not be opened.'); } }}><ExternalLink size={17} /></button></div>
    </div>}
    {newTabError && <div className="viewer-inline-error" role="alert">{newTabError}</div>}
    {downloadNotice && <div className="viewer-inline-notice" role="status">{downloadNotice}</div>}
    <div className="viewer-frame-wrap">
      {status === 'loading' && artifact.datasetKeys.length > 0 && <div className="viewer-overlay" role="status" aria-live="polite"><span className="spinner" /> Loading protected data…</div>}
      {status === 'error' && <div className="viewer-overlay error" role="alert"><strong>Artifact unavailable</strong><span>{error}</span><button className="button" type="button" onClick={() => { setError(''); setStatus('loading'); setFrameKey((value) => value + 1); }}>Try again</button></div>}
      <iframe key={frameKey} ref={frame} title={artifact.title} src={artifact.hostedHtml ? undefined : artifact.entryUrl} srcDoc={artifact.hostedHtml} sandbox={`allow-scripts${artifact.capabilities.includes('downloads') ? ' allow-downloads' : ''}`} onLoad={connect} onError={() => { setError('The artifact frame could not be loaded.'); setStatus('error'); finishAttempt('failed', 'FRAME_LOAD_FAILED'); }} />
    </div>
  </div>;
}
