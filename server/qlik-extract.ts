import type { QlikTableSummary } from '../src/types/portal.js';
import type { QlikCell, QlikColumn, QlikTablePayload } from '../src/lib/qlik-payload.js';
import { expandQlikPayload } from '../src/lib/qlik-transform.js';
import { AppError } from './errors.js';

const APP_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const OBJECT_ID = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_CELLS_PER_PAGE = 10_000;
export const QLIK_DATASET_PART_BYTES = 9 * 1024 * 1024;
export const QLIK_EXTRACT_MAX_BYTES = 50 * 1024 * 1024;
export const QLIK_CHUNK_FORMAT = 'qlik-chunks-v1';
export const QLIK_PREVIEW_MAX_ROWS = 200;

export type { QlikCell, QlikColumn, QlikTablePayload };
export type { ExpandedQlikTablePayload } from '../src/lib/qlik-payload.js';
export { expandQlikPayload };

export interface QlikChunkManifest {
  format: typeof QLIK_CHUNK_FORMAT;
  asOf: string;
  appId: string;
  objectId: string;
  columns: QlikColumn[];
  parts: string[];
  recordCount: number;
}

export interface QlikEngineSession {
  rpc(method: string, handle: number, params?: unknown[]): Promise<unknown>;
  close(): void;
}

export interface QlikExtractOptions {
  tenantUrl: string;
  apiKey: string;
  appId: string;
  objectId: string;
  fetchImpl?: typeof fetch;
  openSession?: (url: string, headers: Record<string, string>) => Promise<QlikEngineSession>;
  maxRows?: number;
  session?: QlikEngineSession;
  appHandle?: number;
}

interface NxInfo {
  qFallbackTitle?: string;
}

interface NxCell {
  qText?: string;
  qNum?: number | string;
  qIsEmpty?: boolean;
}

interface NxDataPage {
  qMatrix?: NxCell[][];
}

interface HyperCubeLayout {
  qMode?: string | number;
  qSize?: { qcx?: number; qcy?: number };
  qDimensionInfo?: NxInfo[];
  qMeasureInfo?: NxInfo[];
}

interface HyperCubeDef {
  qMode?: string | number;
  qDimensions?: Array<{ qDef?: { qFieldDefs?: string[]; qLabel?: string }; qFallbackTitle?: string }>;
  qMeasures?: Array<{ qDef?: { qLabel?: string; qDef?: string }; qFallbackTitle?: string }>;
}

interface QlikObjectLayout {
  title?: string;
  visualization?: string;
  qMeta?: { title?: string };
  qMetaDef?: { title?: string };
  qHyperCube?: HyperCubeLayout;
  qHyperCubeDef?: HyperCubeDef;
  cells?: Array<{ name?: string; type?: string }>;
  qChildList?: { qItems?: Array<{ qInfo?: { qId?: string; qType?: string } }> };
}

export function parseQlikTenantUrl(value: string): { origin: string; host: string } {
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`); }
  catch { throw new AppError(400, 'QLIK_TENANT_INVALID', 'The Qlik tenant URL is invalid.'); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) {
    throw new AppError(400, 'QLIK_TENANT_INVALID', 'The Qlik tenant URL must be HTTPS on port 443.');
  }
  return { origin: url.origin, host: url.host };
}

export function validateQlikAppId(appId: string): string {
  const value = appId.trim();
  if (!APP_ID.test(value)) throw new AppError(400, 'QLIK_APP_INVALID', 'Enter a Qlik app ID (GUID).');
  return value;
}

export function validateQlikObjectRef(input: { appId: string; objectId: string }): { appId: string; objectId: string } {
  const appId = validateQlikAppId(input.appId);
  const objectId = input.objectId.trim();
  if (!OBJECT_ID.test(objectId)) throw new AppError(400, 'QLIK_OBJECT_INVALID', 'Enter a Qlik object ID.');
  return { appId, objectId };
}

export function validateRefreshTime(hour: number, minute: number): { refreshHourUtc: number; refreshMinuteUtc: number } {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new AppError(400, 'QLIK_SCHEDULE_INVALID', 'Choose a daily refresh time in UTC.');
  }
  return { refreshHourUtc: hour, refreshMinuteUtc: minute };
}

export function nextDueAt(from: Date, hour: number, minute: number): Date {
  const due = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0));
  if (due.getTime() <= from.getTime()) due.setUTCDate(due.getUTCDate() + 1);
  return due;
}

export function hyperCubePageHeight(columnCount: number): number {
  const width = Math.max(1, columnCount);
  return Math.max(1, Math.floor(MAX_CELLS_PER_PAGE / width));
}

export function columnKey(title: string, used: Set<string>): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'column';
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function cellValue(cell: NxCell | undefined, _role: QlikColumn['role']): QlikCell {
  if (!cell || cell.qIsEmpty) return null;
  const numeric = typeof cell.qNum === 'number' ? cell.qNum : Number(cell.qNum);
  if (Number.isFinite(numeric)) return numeric;
  if (cell.qText == null || cell.qText === '') return null;
  return cell.qText;
}

export function flattenHyperCube(layout: { qHyperCube?: HyperCubeLayout }, pages: NxDataPage[], meta: { appId: string; objectId: string; asOf?: string }): QlikTablePayload {
  const cube = layout.qHyperCube;
  if (!cube) throw new AppError(400, 'QLIK_OBJECT_UNSUPPORTED', 'That Qlik object does not expose a straight table hypercube.');
  if (cube.qMode && cube.qMode !== 'S') throw new AppError(400, 'QLIK_OBJECT_UNSUPPORTED', 'Only straight Qlik tables can be pulled into the portal.');
  const used = new Set<string>();
  const columns: QlikColumn[] = [
    ...(cube.qDimensionInfo ?? []).map((item) => ({ key: columnKey(item.qFallbackTitle ?? 'dimension', used), title: item.qFallbackTitle || 'Dimension', role: 'dimension' as const })),
    ...(cube.qMeasureInfo ?? []).map((item) => ({ key: columnKey(item.qFallbackTitle ?? 'measure', used), title: item.qFallbackTitle || 'Measure', role: 'measure' as const })),
  ];
  if (!columns.length) throw new AppError(400, 'QLIK_OBJECT_UNSUPPORTED', 'That Qlik table has no dimensions or measures.');
  const rows: QlikCell[][] = [];
  for (const page of pages) {
    for (const line of page.qMatrix ?? []) {
      rows.push(columns.map((column, index) => cellValue(line[index], column.role)));
    }
  }
  const payload: QlikTablePayload = {
    asOf: meta.asOf ?? new Date().toISOString(),
    appId: meta.appId,
    objectId: meta.objectId,
    columns,
    rows,
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > QLIK_EXTRACT_MAX_BYTES) {
    throw new AppError(413, 'DATASET_TOO_LARGE', 'The Qlik extract exceeds the 50 MB assembled limit after compacting. Use a smaller table or fewer columns.');
  }
  return payload;
}

export function isCompactQlikPayload(value: unknown): value is QlikTablePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as QlikTablePayload;
  return Array.isArray(payload.columns) && Array.isArray(payload.rows) && (payload.rows.length === 0 || Array.isArray(payload.rows[0]));
}

export function isQlikChunkManifest(value: unknown): value is QlikChunkManifest {
  return Boolean(value && typeof value === 'object' && (value as QlikChunkManifest).format === QLIK_CHUNK_FORMAT && Array.isArray((value as QlikChunkManifest).parts));
}

export function splitQlikRowChunks(rows: QlikCell[][], maxPartBytes = QLIK_DATASET_PART_BYTES): QlikCell[][][] {
  const chunks: QlikCell[][][] = [];
  let current: QlikCell[][] = [];
  let bytes = 2;
  for (const row of rows) {
    const extra = Buffer.byteLength(JSON.stringify(row)) + (current.length ? 1 : 0);
    if (extra + 2 > maxPartBytes) throw new AppError(413, 'DATASET_TOO_LARGE', 'A single Qlik row exceeds the dataset part limit.');
    if (current.length && bytes + extra > maxPartBytes) {
      chunks.push(current);
      current = [];
      bytes = 2;
    }
    current.push(row);
    bytes += extra;
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

export async function openQlikEngineApp(options: Pick<QlikExtractOptions, 'tenantUrl' | 'apiKey' | 'appId' | 'fetchImpl' | 'openSession'>): Promise<{ session: QlikEngineSession; appHandle: number }> {
  const appId = validateQlikAppId(options.appId);
  const tenant = parseQlikTenantUrl(options.tenantUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const csrfToken = await csrfTokenForEngine(tenant.origin, options.apiKey, fetchImpl);
  const socketUrl = `wss://${tenant.host}/app/${encodeURIComponent(appId)}${csrfToken ? `?qlik-csrf-token=${encodeURIComponent(csrfToken)}` : ''}`;
  const session = await (options.openSession ?? openEngineSession)(socketUrl, { Authorization: `Bearer ${options.apiKey}` });
  try {
    const appHandle = unwrapHandle(await session.rpc('OpenDoc', -1, [appId]));
    if (!Number.isInteger(appHandle)) throw new AppError(502, 'QLIK_UNAVAILABLE', 'Qlik Cloud did not open the app.');
    return { session, appHandle: appHandle as number };
  } catch (error) {
    session.close();
    throw error;
  }
}

export async function extractQlikTable(options: QlikExtractOptions): Promise<QlikTablePayload> {
  return (await extractQlikTableSample(options)).payload;
}

export async function extractQlikTableSample(options: QlikExtractOptions): Promise<{ payload: QlikTablePayload; sourceRowCount: number }> {
  const { appId, objectId } = validateQlikObjectRef(options);
  if (options.session && Number.isInteger(options.appHandle)) {
    return extractFromOpenApp(options.session, options.appHandle as number, { ...options, appId, objectId });
  }
  const opened = await openQlikEngineApp(options);
  try {
    return await extractFromOpenApp(opened.session, opened.appHandle, { ...options, appId, objectId });
  } finally {
    opened.session.close();
  }
}

async function extractFromOpenApp(session: QlikEngineSession, appHandle: number, options: { appId: string; objectId: string; maxRows?: number }): Promise<{ payload: QlikTablePayload; sourceRowCount: number }> {
  const objectHandle = unwrapHandle(await session.rpc('GetObject', appHandle, [options.objectId]));
  if (!Number.isInteger(objectHandle)) throw new AppError(404, 'QLIK_OBJECT_NOT_FOUND', 'The Qlik object was not found in that app.');
  const layout = unwrapLayout(await session.rpc('GetLayout', objectHandle as number, []));
  const cube = layout.qHyperCube;
  const width = Math.max(1, Number(cube?.qSize?.qcx ?? 0));
  const sourceRowCount = Number(cube?.qSize?.qcy ?? 0);
  const height = options.maxRows == null ? sourceRowCount : Math.min(sourceRowCount, Math.max(0, options.maxRows));
  const pageHeight = hyperCubePageHeight(width);
  const pages: NxDataPage[] = [];
  for (let top = 0; top < Math.max(height, 0); top += pageHeight) {
    const chunk = unwrapDataPages(await session.rpc('GetHyperCubeData', objectHandle as number, ['/qHyperCubeDef', [{ qTop: top, qLeft: 0, qWidth: width, qHeight: Math.min(pageHeight, height - top) }]]));
    pages.push(...chunk);
  }
  const payload = flattenHyperCube(layout, pages, { appId: options.appId, objectId: options.objectId });
  if (options.maxRows != null && payload.rows.length > options.maxRows) payload.rows = payload.rows.slice(0, options.maxRows);
  return { payload, sourceRowCount };
}

const TABLE_LAYOUT_CONCURRENCY = 8;
const OBJECT_RPC_MS = 20_000;

export async function listQlikTables(session: QlikEngineSession, appHandle: number, options?: { objectTimeoutMs?: number }): Promise<QlikTableSummary[]> {
  const timeoutMs = options?.objectTimeoutMs ?? OBJECT_RPC_MS;
  const infos = unwrapInfos(await timedRpc(session, 'GetAllInfos', appHandle, [], timeoutMs));
  const typeById = new Map(infos.map((item) => [item.qId?.trim() ?? '', item.qType ?? 'object']));
  const sheetTitleByObject = new Map<string, string>();
  const candidates = new Map<string, string>();
  const sheets = infos.filter((item) => String(item.qType ?? '').toLowerCase() === 'sheet');
  await mapPool(sheets, TABLE_LAYOUT_CONCURRENCY, async (info) => {
    try {
      const handle = unwrapHandle(await timedRpc(session, 'GetObject', appHandle, [info.qId], timeoutMs));
      if (!Number.isInteger(handle)) return;
      const properties = unwrapProperties(await timedRpc(session, 'GetProperties', handle as number, [], timeoutMs));
      const title = objectTitle(properties, info.qId || 'Sheet');
      const children = unwrapInfos(await timedRpc(session, 'GetChildInfos', handle as number, [], timeoutMs));
      for (const child of sheetChildRefs(properties, children)) {
        sheetTitleByObject.set(child.id, title);
        if (isTableCandidate(child.qType || typeById.get(child.id) || 'object')) candidates.set(child.id, child.qType || typeById.get(child.id) || 'object');
      }
    } catch (error) {
      if (isFatalQlikError(error)) throw error;
    }
  });
  for (const info of infos) {
    const objectId = info.qId?.trim() ?? '';
    const qType = info.qType ?? 'object';
    if (!objectId || qType.toLowerCase() === 'sheet') continue;
    if (looksLikeTableType(qType)) candidates.set(objectId, qType);
  }
  const tables: QlikTableSummary[] = [];
  await mapPool([...candidates.entries()], TABLE_LAYOUT_CONCURRENCY, async ([objectId, qType]) => {
    try {
      const handle = unwrapHandle(await timedRpc(session, 'GetObject', appHandle, [objectId], timeoutMs));
      if (!Number.isInteger(handle)) return;
      const properties = unwrapProperties(await timedRpc(session, 'GetProperties', handle as number, [], timeoutMs));
      if (!isStraightTableObject(properties, qType)) return;
      const columns = columnsFromObject(properties);
      if (!columns.length) return;
      tables.push({
        objectId,
        title: objectTitle(properties, objectId),
        sheetTitle: sheetTitleByObject.get(objectId) ?? '',
        qType,
        columns,
        rowCount: Number(properties.qHyperCube?.qSize?.qcy ?? 0),
      });
    } catch (error) {
      if (isFatalQlikError(error)) throw error;
    }
  });
  tables.sort((left, right) => {
    const sheet = left.sheetTitle.localeCompare(right.sheetTitle);
    return sheet || left.title.localeCompare(right.title);
  });
  return tables;
}

function sheetChildRefs(layout: QlikObjectLayout, children: Array<{ qId?: string; qType?: string }>): Array<{ id: string; qType: string }> {
  const refs = new Map<string, string>();
  for (const child of children) {
    const id = child.qId?.trim();
    if (id) refs.set(id, child.qType ?? '');
  }
  for (const cell of layout.cells ?? []) {
    const id = typeof cell.name === 'string' ? cell.name.trim() : '';
    if (id) refs.set(id, cell.type ?? refs.get(id) ?? '');
  }
  for (const item of layout.qChildList?.qItems ?? []) {
    const id = item.qInfo?.qId?.trim();
    if (id) refs.set(id, item.qInfo?.qType ?? refs.get(id) ?? '');
  }
  return [...refs.entries()].map(([id, qType]) => ({ id, qType }));
}

function looksLikeTableType(qType: string): boolean {
  const type = qType.toLowerCase();
  return type.includes('table') && !type.includes('pivot') && !type.includes('stacked') && !type.includes('tree');
}

function isTableCandidate(qType: string): boolean {
  const type = qType.trim().toLowerCase();
  return !type || type === 'object' || type === 'masterobject' || looksLikeTableType(type);
}

async function mapPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  if (!items.length) return;
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await work(current);
    }
  });
  await Promise.all(workers);
}

function isFatalQlikError(error: unknown): boolean {
  return error instanceof AppError && (error.code === 'QLIK_UNAVAILABLE' || error.code === 'QLIK_AUTH_FAILED' || error.code === 'QLIK_ENGINE_ERROR');
}

function objectTitle(layout: QlikObjectLayout, fallback: string): string {
  if (typeof layout.title === 'string' && layout.title.trim()) return layout.title.trim();
  if (layout.qMeta?.title?.trim()) return layout.qMeta.title.trim();
  if (layout.qMetaDef?.title?.trim()) return layout.qMetaDef.title.trim();
  return fallback;
}

function columnsFromObject(layout: QlikObjectLayout): string[] {
  if (layout.qHyperCube) {
    return [
      ...(layout.qHyperCube.qDimensionInfo ?? []).map((item) => item.qFallbackTitle || 'Dimension'),
      ...(layout.qHyperCube.qMeasureInfo ?? []).map((item) => item.qFallbackTitle || 'Measure'),
    ].filter(Boolean);
  }
  const def = layout.qHyperCubeDef;
  if (!def) return [];
  return [
    ...(def.qDimensions ?? []).map((item) => item.qDef?.qLabel || item.qFallbackTitle || item.qDef?.qFieldDefs?.[0] || 'Dimension'),
    ...(def.qMeasures ?? []).map((item) => item.qDef?.qLabel || item.qFallbackTitle || 'Measure'),
  ].filter(Boolean);
}

function isStraightTableObject(layout: QlikObjectLayout, qType: string): boolean {
  const viz = `${layout.visualization ?? ''} ${qType}`.toLowerCase();
  if (viz.includes('pivot') || viz.includes('tree') || viz.includes('stacked')) return false;
  const mode = layout.qHyperCube?.qMode ?? layout.qHyperCubeDef?.qMode;
  if (mode === 'P' || mode === 'K' || mode === 'T' || mode === 1 || mode === '1') return false;
  return Boolean(layout.qHyperCube || layout.qHyperCubeDef) || looksLikeTableType(qType);
}

async function timedRpc(session: QlikEngineSession, method: string, handle: number, params: unknown[] = [], ms = OBJECT_RPC_MS): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      session.rpc(method, handle, params),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AppError(504, 'QLIK_RPC_TIMEOUT', `Qlik Cloud did not respond to ${method} in time.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unwrapInfos(result: unknown): Array<{ qId?: string; qType?: string }> {
  if (!result || typeof result !== 'object') return [];
  const record = result as { qInfos?: Array<{ qId?: string; qType?: string }>; qReturn?: { qInfos?: Array<{ qId?: string; qType?: string }> } };
  if (Array.isArray(record.qInfos)) return record.qInfos;
  if (Array.isArray(record.qReturn?.qInfos)) return record.qReturn.qInfos;
  return [];
}

async function qlikErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.clone().json() as { errors?: Array<{ title?: string; detail?: string }> };
    const first = body.errors?.[0];
    return [first?.title, first?.detail].filter(Boolean).join(' — ');
  } catch {
    return '';
  }
}

async function csrfTokenForEngine(tenantOrigin: string, apiKey: string, fetchImpl: typeof fetch): Promise<string> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  let response: Response;
  try {
    response = await fetchImpl(`${tenantOrigin}/api/v1/csrf-token`, { headers });
  } catch {
    throw new AppError(502, 'QLIK_UNAVAILABLE', 'Launchpad could not reach Qlik Cloud. Check QLIK_TENANT_URL and that App Service can make outbound HTTPS calls.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(401, 'QLIK_AUTH_FAILED', 'The Qlik API key was rejected. Generate a new key and update QLIK_API_KEY.');
  }
  if (response.ok) return response.headers.get('qlik-csrf-token') ?? '';
  // API keys often cannot use the CSRF endpoint (HTTP 400). The engine websocket
  // still accepts Authorization: Bearer, so continue without a token.
  if (response.status === 400 || response.status === 404) return '';
  const detail = await qlikErrorDetail(response);
  throw new AppError(502, 'QLIK_UNAVAILABLE', detail || `Qlik Cloud could not issue a session token (HTTP ${response.status}).`);
}

function unwrapHandle(result: unknown): number | undefined {
  if (typeof result === 'number') return result;
  if (!result || typeof result !== 'object') return undefined;
  const record = result as { qHandle?: number; qReturn?: { qHandle?: number } | number };
  if (typeof record.qHandle === 'number') return record.qHandle;
  if (typeof record.qReturn === 'number') return record.qReturn;
  if (record.qReturn && typeof record.qReturn === 'object' && typeof record.qReturn.qHandle === 'number') return record.qReturn.qHandle;
  return undefined;
}

function unwrapLayout(result: unknown): QlikObjectLayout {
  if (!result || typeof result !== 'object') return {};
  const record = result as QlikObjectLayout & { qLayout?: QlikObjectLayout };
  if (record.qHyperCube || record.title || record.qMeta || record.cells || record.qChildList) return record;
  if (record.qLayout) return record.qLayout;
  return record;
}

function unwrapProperties(result: unknown): QlikObjectLayout {
  if (!result || typeof result !== 'object') return {};
  const record = result as QlikObjectLayout & { qProp?: QlikObjectLayout };
  if (record.qProp) return record.qProp;
  return record;
}

function unwrapDataPages(result: unknown): NxDataPage[] {
  if (Array.isArray(result)) return result as NxDataPage[];
  if (result && typeof result === 'object' && Array.isArray((result as { qDataPages?: NxDataPage[] }).qDataPages)) {
    return (result as { qDataPages: NxDataPage[] }).qDataPages;
  }
  return [];
}

async function openEngineSession(url: string, headers: Record<string, string>): Promise<QlikEngineSession> {
  const socket = new WebSocket(url, { headers } as never);
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new AppError(504, 'QLIK_UNAVAILABLE', 'Timed out connecting to Qlik Cloud.')), 30_000);
    socket.addEventListener('open', () => { setTimeout(() => finish(), 50); });
    socket.addEventListener('error', () => {
      finish(new AppError(502, 'QLIK_UNAVAILABLE', 'Could not open a Qlik engine session.'));
    });
    socket.addEventListener('message', (event) => {
      let payload: { method?: string; id?: number; result?: unknown; error?: { message?: string; code?: number }; params?: { mustAuthenticate?: boolean } };
      try { payload = JSON.parse(String(event.data)) as typeof payload; }
      catch { return; }
      if (payload.method === 'OnConnected' || payload.method === 'OnAuthenticationInformation') {
        if (payload.method === 'OnAuthenticationInformation' && payload.params?.mustAuthenticate) {
          finish(new AppError(401, 'QLIK_AUTH_FAILED', 'The Qlik API key was rejected. Generate a new key and update QLIK_API_KEY.'));
          return;
        }
        finish();
        return;
      }
      if (typeof payload.id === 'number' && pending.has(payload.id)) {
        const waiter = pending.get(payload.id)!;
        pending.delete(payload.id);
        if (payload.error) waiter.reject(new AppError(502, 'QLIK_ENGINE_ERROR', payload.error.message || 'Qlik Cloud returned an engine error.'));
        else waiter.resolve(payload.result);
      }
    });
    socket.addEventListener('close', () => {
      finish(new AppError(502, 'QLIK_UNAVAILABLE', 'The Qlik engine session closed unexpectedly.'));
      for (const waiter of pending.values()) waiter.reject(new AppError(502, 'QLIK_UNAVAILABLE', 'The Qlik engine session closed unexpectedly.'));
      pending.clear();
    });
  });
  await ready;
  return {
    rpc(method, handle, params = []) {
      const id = nextId;
      nextId += 1;
      const timeoutMs = method === 'OpenDoc' ? 120_000 : method === 'GetLayout' || method === 'GetHyperCubeData' ? 90_000 : 20_000;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new AppError(504, 'QLIK_UNAVAILABLE', method === 'OpenDoc'
            ? 'Qlik Cloud is still opening that app. Try again in a moment.'
            : `Qlik Cloud did not respond to ${method} in time.`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        try {
          socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, handle, params }));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new AppError(502, 'QLIK_UNAVAILABLE', 'The Qlik engine session closed unexpectedly.'));
        }
      });
    },
    close() {
      try { socket.close(); } catch { /* already closed */ }
    },
  };
}
