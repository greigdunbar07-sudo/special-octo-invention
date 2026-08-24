import { portalApi } from '@/services/portalApi';
import type { QlikTableSummary } from '@/types/portal';

const ready = new Map<string, QlikTableSummary[]>();
const inflight = new Map<string, Promise<QlikTableSummary[]>>();

export function peekQlikTables(appId: string): QlikTableSummary[] | undefined {
  return ready.get(appId);
}

export function prefetchQlikTables(appId: string): Promise<QlikTableSummary[]> {
  const id = appId.trim();
  if (!id) return Promise.resolve([]);
  const cached = ready.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;
  const next = portalApi.listQlikTables(id).then((tables) => {
    ready.set(id, tables);
    return tables;
  }).finally(() => { inflight.delete(id); });
  inflight.set(id, next);
  return next;
}

export function prefetchQlikTableCatalog(appIds: string[], limit = 2): void {
  const unique = [...new Set(appIds.map((id) => id.trim()).filter(Boolean))];
  for (const id of unique.slice(0, limit)) {
    void prefetchQlikTables(id).catch(() => undefined);
  }
}
