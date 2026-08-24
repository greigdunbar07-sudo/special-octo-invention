import { ArrowLeft, ChevronRight, Database, Eye, EyeOff, Filter, MoreHorizontal, RefreshCw, Table2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';

import { PageState } from './HomePage';
import { useConfirm } from '@/components/ConfirmDialog';
import { applyQlikClean, sameQlikColumn } from '@/lib/qlik-transform';
import type { QlikTablePayload } from '@/lib/qlik-payload';
import { usePortal } from '@/hooks/PortalContext';
import { portalApi } from '@/services/portalApi';
import type {
  ArtifactSummary,
  QlikCleanKeys,
  QlikCleanOutput,
  QlikCleanRecipe,
  QlikDatasetBinding,
  QlikPreviewSample,
  QlikRowFilter,
  QlikRowFilterMode,
  QlikRowFilterOp,
} from '@/types/portal';
import { DEFAULT_QLIK_CLEAN_RECIPE } from '@/types/portal';

const LIBRARY_HREF = '/admin?tab=artifacts';
const ROW_FILTER_OPS: Array<{ value: QlikRowFilterOp; label: string }> = [
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Does not equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'empty', label: 'Is empty' },
  { value: 'notEmpty', label: 'Is not empty' },
];

export function QlikQueryPage() {
  const { artifactId = '', datasetKey = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { identity, loading: portalLoading } = usePortal();
  const [artifact, setArtifact] = useState<ArtifactSummary | null>(null);
  const [binding, setBinding] = useState<QlikDatasetBinding | null>(null);
  const [qlikConfigured, setQlikConfigured] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draftAppId, setDraftAppId] = useState('');
  const [draftObjectId, setDraftObjectId] = useState('');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [sample, setSample] = useState<QlikPreviewSample | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [recipe, setRecipe] = useState<QlikCleanRecipe>({ ...DEFAULT_QLIK_CLEAN_RECIPE, keepColumns: [], rowFilters: [] });
  const [time, setTime] = useState('08:00');
  const [saved, setSaved] = useState({ appId: '', objectId: '', time: '08:00', recipe: serializeRecipe({ ...DEFAULT_QLIK_CLEAN_RECIPE, keepColumns: [], rowFilters: [] }) });
  const [notice, setNotice] = useState<{ kind: 'progress' | 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterColumn, setFilterColumn] = useState('');
  const [navDrawer, setNavDrawer] = useState<'source' | 'steps' | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  const loadPreview = useCallback(async (appId: string, objectId: string) => {
    setPreviewBusy(true); setPreviewError('');
    try { setSample(await portalApi.previewQlikTable({ appId, objectId })); }
    catch (caught) { setSample(null); setPreviewError(caught instanceof Error ? caught.message : 'The Qlik table could not be previewed.'); }
    finally { setPreviewBusy(false); }
  }, []);

  const dirty = draftAppId.trim() !== saved.appId || draftObjectId.trim() !== saved.objectId || time !== saved.time || serializeRecipe(recipe) !== saved.recipe;

  useEffect(() => {
    if (identity?.role !== 'admin') return;
    void (async () => {
      try {
        const context = await portalApi.getQlikBindingContext(artifactId, datasetKey);
        setArtifact(context.artifact);
        setBinding(context.binding);
        setQlikConfigured(context.qlikConfigured);
        if (context.binding) applyBinding(context.binding);
      } catch (caught) {
        setLoadError(caught instanceof Error ? caught.message : 'Administration data could not be loaded.');
      }
    })();
  }, [artifactId, datasetKey, identity?.role]);

  useEffect(() => {
    if (!selectedAppId || !selectedObjectId || !qlikConfigured) { setSample(null); return; }
    void loadPreview(selectedAppId, selectedObjectId);
  }, [loadPreview, selectedAppId, selectedObjectId, qlikConfigured]);

  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);

  function applyBinding(current: QlikDatasetBinding) {
    const nextRecipe = { ...DEFAULT_QLIK_CLEAN_RECIPE, ...current.transform, keepColumns: [...(current.transform.keepColumns ?? [])], rowFilters: [...(current.transform.rowFilters ?? [])] };
    const nextTime = `${pad(current.refreshHourUtc)}:${pad(current.refreshMinuteUtc)}`;
    setDraftAppId(current.appId);
    setDraftObjectId(current.objectId);
    setSelectedAppId(current.appId);
    setSelectedObjectId(current.objectId);
    setRecipe(nextRecipe);
    setTime(nextTime);
    setSaved({ appId: current.appId, objectId: current.objectId, time: nextTime, recipe: serializeRecipe(nextRecipe) });
  }

  const cleaned = useMemo(() => {
    if (!sample) return null;
    const payload: QlikTablePayload = {
      asOf: new Date().toISOString(),
      appId: sample.appId, objectId: sample.objectId, columns: sample.columns, rows: sample.rows,
    };
    try { return applyQlikClean(payload, recipe); }
    catch { return payload; }
  }, [sample, recipe]);
  const statusText = previewBusy
    ? 'Loading a preview of the first 200 source rows…'
    : cleaned && sample
      ? `Preview of first ${sample.rows.length.toLocaleString('en-GB')} of ${sample.sourceRowCount.toLocaleString('en-GB')} source rows${recipe.rowFilters.length || recipe.dropEmptyRows ? ` · ${cleaned.rows.length.toLocaleString('en-GB')} after steps` : ''}.`
      : selectedObjectId
        ? previewError || 'Preview the object IDs to load rows.'
        : 'Paste a Qlik app ID and straight-table object ID.';

  function previewIds(event: FormEvent) {
    event.preventDefault();
    const appId = draftAppId.trim();
    const objectId = draftObjectId.trim();
    if (!appId || !objectId) { setNotice({ kind: 'error', text: 'Enter both a Qlik app ID and an object ID.' }); return; }
    setSelectedAppId(appId);
    setSelectedObjectId(objectId);
    setNavDrawer(null);
  }

  async function save() {
    const appId = draftAppId.trim();
    const objectId = draftObjectId.trim();
    if (!appId || !objectId) { setNotice({ kind: 'error', text: 'Enter a Qlik app ID and object ID before saving.' }); return; }
    setBusy('save'); setNotice({ kind: 'progress', text: 'Saving Qlik source…' });
    try {
      const next = await portalApi.saveQlikBinding(artifactId, datasetKey, { appId, objectId, ...scheduleFrom(time), transform: recipe });
      setBinding(next);
      setSelectedAppId(appId);
      setSelectedObjectId(objectId);
      setSaved({ appId, objectId, time, recipe: serializeRecipe(recipe) });
      setNotice({ kind: 'success', text: 'Qlik source saved.' });
    } catch (caught) { setNotice({ kind: 'error', text: caught instanceof Error ? caught.message : 'The Qlik source could not be saved.' }); }
    finally { setBusy(''); }
  }

  async function pull() {
    setBusy('pull'); setNotice({ kind: 'progress', text: 'Pulling from Qlik… this can take about a minute.' });
    try {
      if (dirty) {
        const appId = draftAppId.trim();
        const objectId = draftObjectId.trim();
        const next = await portalApi.saveQlikBinding(artifactId, datasetKey, { appId, objectId, ...scheduleFrom(time), transform: recipe });
        setBinding(next);
        setSelectedAppId(appId);
        setSelectedObjectId(objectId);
        setSaved({ appId, objectId, time, recipe: serializeRecipe(recipe) });
      }
      const result = await portalApi.pullQlikBinding(artifactId, datasetKey);
      setBinding(result);
      setNotice({ kind: 'success', text: result.lastRecordCount == null ? 'Qlik table stored.' : `${result.lastRecordCount} row${result.lastRecordCount === 1 ? '' : 's'} stored.` });
    } catch (caught) { setNotice({ kind: 'error', text: caught instanceof Error ? caught.message : 'The Qlik pull failed.' }); }
    finally { setBusy(''); }
  }

  async function clearBinding() {
    if (!binding || !(await confirm({ title: 'Remove the saved Qlik source?', body: 'Scheduled pulls stop for this dataset. Existing stored data is kept until it is replaced.', confirmLabel: 'Remove', danger: true }))) return;
    setBusy('clear'); setMenuOpen(false);
    try {
      await portalApi.deleteQlikBinding(artifactId, datasetKey);
      setBinding(null);
      setDraftAppId(''); setDraftObjectId('');
      setSelectedAppId(''); setSelectedObjectId(''); setSample(null);
      setRecipe({ ...DEFAULT_QLIK_CLEAN_RECIPE, keepColumns: [], rowFilters: [] });
      setSaved({ appId: '', objectId: '', time, recipe: serializeRecipe({ ...DEFAULT_QLIK_CLEAN_RECIPE, keepColumns: [], rowFilters: [] }) });
      setNotice({ kind: 'success', text: 'Qlik source removed.' });
    } catch (caught) { setNotice({ kind: 'error', text: caught instanceof Error ? caught.message : 'The Qlik source could not be cleared.' }); }
    finally { setBusy(''); }
  }

  if (portalLoading) return <PageState title="Opening query editor" body="Checking administrator access…" />;
  if (identity?.role !== 'admin') return <Navigate to="/" replace />;
  if (loadError) return <PageState title="Query editor unavailable" body={loadError} action={<Link className="button primary" to={LIBRARY_HREF}>Back to Library</Link>} />;
  if (!artifact) return <PageState title="Library item not found" body="That dataset is not in the library." action={<Link className="button primary" to={LIBRARY_HREF}>Back to Library</Link>} />;

  return <div className="qlik-workspace">
    {leaveOpen && <div className="qlik-leave" role="dialog" aria-modal="true" aria-labelledby="qlik-leave-title">
      <div>
        <h2 id="qlik-leave-title">Leave without saving?</h2>
        <p>The Qlik source and steps have not been saved.</p>
        <div className="qlik-leave-actions">
          <button className="button" type="button" onClick={() => setLeaveOpen(false)}>Stay</button>
          <button className="button primary" type="button" onClick={() => navigate(LIBRARY_HREF)}>Leave</button>
        </div>
      </div>
    </div>}
    <header className="qlik-chrome">
      <div className="qlik-chrome-start">
        <button className="qlik-back" type="button" onClick={() => { if (dirty) setLeaveOpen(true); else navigate(LIBRARY_HREF); }}><ArrowLeft size={17} /> Library</button>
        <div><strong>{artifact.title} · {datasetKey}</strong><small>Qlik query editor</small></div>
      </div>
      <p className="qlik-chrome-status" role="status">{statusText}</p>
      <div className="qlik-chrome-actions">
        {dirty && <span className="qlik-unsaved">Unsaved</span>}
        <button className="qlik-pane-toggle" type="button" onClick={() => setNavDrawer((value) => value === 'source' ? null : 'source')}>Source</button>
        <button className="qlik-pane-toggle" type="button" onClick={() => setNavDrawer((value) => value === 'steps' ? null : 'steps')}>Steps</button>
        <button className="button" type="button" disabled={Boolean(busy) || !binding} onClick={() => void pull()}>{busy === 'pull' ? 'Pulling…' : 'Pull now'}</button>
        <button className="button primary" type="button" disabled={Boolean(busy) || !draftAppId.trim() || !draftObjectId.trim()} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save source'}</button>
        <div className="qlik-overflow" ref={menu}>
          <button className="icon-button" type="button" aria-label="More actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={18} /></button>
          {menuOpen && <div className="qlik-overflow-menu" role="menu">
            <button type="button" className="danger" disabled={!binding || Boolean(busy)} onClick={() => void clearBinding()}>Clear source</button>
          </div>}
        </div>
      </div>
    </header>
    {notice && <div className={`qlik-banner qlik-banner-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}<button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button></div>}
    <div className={`qlik-panes${navDrawer ? ` qlik-drawer-${navDrawer}` : ''}`}>
      <aside className="qlik-nav" aria-label="Qlik source">
        <div className="qlik-pane-head"><Database size={15} /> Source</div>
        {!qlikConfigured && <p className="qlik-empty">Set QLIK_TENANT_URL and QLIK_API_KEY on the App Service, then refresh.</p>}
        {qlikConfigured && <form className="qlik-advanced" onSubmit={previewIds}>
          <p>Paste the Qlik app GUID and the straight-table object ID. Preview loads the first 200 source rows.</p>
          <label>App ID<input value={draftAppId} onChange={(event) => setDraftAppId(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <label>Object ID<input value={draftObjectId} onChange={(event) => setDraftObjectId(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <button className="button primary" type="submit" disabled={!draftAppId.trim() || !draftObjectId.trim() || previewBusy}>{previewBusy ? 'Opening…' : 'Preview'}</button>
        </form>}
      </aside>
      <section className="qlik-grid" aria-label="Preview">
        {!selectedObjectId && <div className="qlik-grid-empty"><Table2 size={22} /><strong>Enter app and object IDs</strong><p>Paste both IDs on the left, then preview the first 200 source rows.</p></div>}
        {selectedObjectId && previewBusy && <div className="qlik-grid-empty"><span className="spinner" /><strong>Loading preview</strong><p>Opening the Qlik object can take a moment.</p></div>}
        {selectedObjectId && previewError && !previewBusy && <div className="qlik-grid-empty" role="alert"><strong>Preview failed</strong><p>{previewError}</p><button className="button" type="button" onClick={() => void loadPreview(selectedAppId, selectedObjectId)}><RefreshCw size={15} /> Try again</button></div>}
        {cleaned && !previewBusy && <>
          {filterColumn && <ColumnFilter column={(cleaned.columns.find((item) => item.key === filterColumn) ?? cleaned.columns[0]).title} recipe={recipe} onChange={setRecipe} onClose={() => setFilterColumn('')} />}
          <div className="qlik-sheet">
          <table>
            <caption className="sr-only">Qlik preview</caption>
            <thead>
              <tr>{cleaned.columns.map((column) => {
                const kept = isKept(recipe, column);
                return <th key={column.key} scope="col">
                  <div className="qlik-th">
                    <button type="button" className="qlik-th-keep" aria-pressed={kept} aria-label={`${kept ? 'Hide' : 'Keep'} ${column.title}`} onClick={() => setRecipe((current) => toggleColumn(current, column, sample?.columns ?? cleaned.columns))}>{kept ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                    <span title={column.title}>{column.title}</span>
                    <button type="button" className={recipe.rowFilters.some((item) => sameQlikColumn(column, item.column)) ? 'active' : ''} aria-label={`Filter ${column.title}`} onClick={() => setFilterColumn((value) => value === column.key ? '' : column.key)}><Filter size={13} /></button>
                  </div>
                </th>;
              })}</tr>
            </thead>
            <tbody>
              {cleaned.rows.length === 0 && <tr><td colSpan={Math.max(1, cleaned.columns.length)}>No rows remain after the applied steps in this preview.</td></tr>}
              {cleaned.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => {
                const numeric = typeof cell === 'number';
                const text = cell == null ? '' : String(cell);
                return <td key={cellIndex} className={numeric ? 'num' : undefined} title={text}>{text}</td>;
              })}</tr>)}
            </tbody>
          </table>
          </div>
        </>}
      </section>
      <aside className="qlik-steps" aria-label="Applied steps">
        <div className="qlik-pane-head">Applied steps</div>
        <ol>
          <li className={selectedObjectId ? 'active' : ''}>
            <span>1</span><div><strong>Source</strong><small>{selectedAppId || 'Enter an app ID'} {selectedObjectId ? <><ChevronRight size={11} /> {selectedObjectId}</> : null}</small></div>
          </li>
          <li className={recipe.keepColumns.length ? 'active' : ''}>
            <span>2</span><div><strong>Keep columns</strong><small>{recipe.keepColumns.length ? `${recipe.keepColumns.length} of ${sample?.columns.length ?? recipe.keepColumns.length} columns` : 'All columns'}</small></div>
            {recipe.keepColumns.length > 0 && <button type="button" className="text-button" onClick={() => setRecipe((current) => ({ ...current, keepColumns: [] }))}>Remove</button>}
          </li>
          <li className={recipe.rowFilters.length ? 'active' : ''}>
            <span>3</span><div>
              <strong>Filter rows</strong>
              <small>{recipe.rowFilters.length ? `${recipe.rowFilters.length} condition${recipe.rowFilters.length === 1 ? '' : 's'} · match ${recipe.rowFilterMode === 'or' ? 'any' : 'all'}` : 'No row conditions'}</small>
              {recipe.rowFilters.length > 1 && <label className="qlik-step-mode">Match <select value={recipe.rowFilterMode} onChange={(event) => setRecipe((current) => ({ ...current, rowFilterMode: event.target.value as QlikRowFilterMode }))}><option value="and">all</option><option value="or">any</option></select></label>}
            </div>
            {recipe.rowFilters.length > 0 && <button type="button" className="text-button" onClick={() => setRecipe((current) => ({ ...current, rowFilters: [] }))}>Remove</button>}
          </li>
          <li className={recipe.dropEmptyRows ? 'active' : ''}>
            <span>4</span><div><strong>Remove blank rows</strong><label className="qlik-check"><input type="checkbox" checked={recipe.dropEmptyRows} onChange={(event) => setRecipe((current) => ({ ...current, dropEmptyRows: event.target.checked }))} /> Drop empty rows</label></div>
          </li>
        </ol>
        <div className="qlik-load">
          <div className="qlik-pane-head">Close and load</div>
          <p>Report shape is applied when the artifact reads the dataset. Keep, filter, and drop-empty change what is stored.</p>
          <label>Daily pull (UTC)<input type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label>
          <label>JSON the report receives<select value={recipe.output} onChange={(event) => { const output = event.target.value as QlikCleanOutput; setRecipe((current) => ({ ...current, output, keys: output !== 'qlik' && current.keys === 'slug' ? 'title' : current.keys })); }}><option value="qlik">Qlik table envelope</option><option value="rows">Named row array</option><option value="as-of-rows">asOf plus named rows</option></select></label>
          <label>Column names<select value={recipe.keys} onChange={(event) => setRecipe((current) => ({ ...current, keys: event.target.value as QlikCleanKeys }))}><option value="slug">Slug keys</option><option value="title">Original titles</option></select></label>
        </div>
      </aside>
    </div>
  </div>;
}

function ColumnFilter({ column, recipe, onChange, onClose }: { column: string; recipe: QlikCleanRecipe; onChange: (recipe: QlikCleanRecipe) => void; onClose: () => void }) {
  const existing = recipe.rowFilters.find((item) => item.column === column);
  const [op, setOp] = useState<QlikRowFilterOp>(existing?.op ?? 'contains');
  const [value, setValue] = useState(existing?.value ?? '');
  function apply(event: FormEvent) {
    event.preventDefault();
    const next: QlikRowFilter = opNeedsValue(op) ? { column, op, value: value.trim() } : { column, op };
    if (opNeedsValue(op) && !value.trim()) return;
    onChange({ ...recipe, rowFilters: [...recipe.rowFilters.filter((item) => item.column !== column), next] });
    onClose();
  }
  return <form className="qlik-filter-bar" onSubmit={apply}>
    <label>Condition<select value={op} onChange={(event) => setOp(event.target.value as QlikRowFilterOp)}>{ROW_FILTER_OPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    {opNeedsValue(op) && <label>Value<input value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" /></label>}
    <div className="qlik-filter-actions">
      <button className="button primary" type="submit">Apply</button>
      {existing && <button className="text-button" type="button" onClick={() => { onChange({ ...recipe, rowFilters: recipe.rowFilters.filter((item) => item.column !== column) }); onClose(); }}>Clear</button>}
    </div>
  </form>;
}

function isKept(recipe: QlikCleanRecipe, column: { key: string; title: string }) {
  if (!recipe.keepColumns.length) return true;
  return recipe.keepColumns.some((item) => sameQlikColumn(column, item));
}

function toggleColumn(recipe: QlikCleanRecipe, column: { key: string; title: string }, all: Array<{ key: string; title: string }>): QlikCleanRecipe {
  const hiding = isKept(recipe, column);
  const current = recipe.keepColumns.length ? recipe.keepColumns : all.map((item) => item.title);
  const next = hiding
    ? current.filter((item) => !sameQlikColumn(column, item))
    : [...current, column.title];
  const unique = [...new Set(next)];
  return { ...recipe, keepColumns: unique.length === all.length ? [] : unique };
}

function serializeRecipe(recipe: QlikCleanRecipe) {
  return JSON.stringify(recipe);
}

function scheduleFrom(time: string) {
  const [hourText, minuteText] = time.split(':');
  return { refreshHourUtc: Number(hourText), refreshMinuteUtc: Number(minuteText) };
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function opNeedsValue(op: QlikRowFilterOp) {
  return op !== 'empty' && op !== 'notEmpty';
}
