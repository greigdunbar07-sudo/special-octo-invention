import type { PortalRepository } from './repository.js';

const DAY_MS = 24 * 60 * 60_000;

export function startUsageMaintenance(repository: PortalRepository, retentionDays: number, initialDelayMs = 60_000): () => void {
  let stopped = false;
  const cleanup = async () => {
    if (stopped) return;
    try {
      const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
      const deleted = await repository.deleteUsageEventsBefore(cutoff);
      console.log(JSON.stringify({ event: 'usage.retention.completed', deleted, cutoff: cutoff.toISOString() }));
    } catch {
      console.error(JSON.stringify({ event: 'usage.retention.failed', code: 'INTERNAL_ERROR' }));
    }
  };
  const first = setTimeout(() => void cleanup(), initialDelayMs);
  first.unref();
  const interval = setInterval(() => void cleanup(), DAY_MS);
  interval.unref();
  return () => { stopped = true; clearTimeout(first); clearInterval(interval); };
}
