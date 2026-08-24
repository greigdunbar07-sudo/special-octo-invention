import { hostname } from 'node:os';

import { AppError } from './errors.js';
import type { QlikPullService } from './qlik.js';
import type { PortalRepository } from './repository.js';

const INTERVAL_MS = 60_000;

export function startQlikScheduler(repository: PortalRepository, qlik: QlikPullService, intervalMs = INTERVAL_MS): () => void {
  let stopped = false;
  const owner = `${hostname().slice(0, 40)}-${crypto.randomUUID().slice(0, 8)}`;
  const tick = async () => {
    if (stopped) return;
    const admin = await repository.bootstrapAdmin();
    if (!admin) return;
    const due = await repository.claimDueQlikBindings(owner);
    for (const binding of due) {
      if (stopped) return;
      try {
        await qlik.pull(admin, binding.artifactId, binding.datasetKey);
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
        console.error(JSON.stringify({ event: 'qlik.pull.failed', code, datasetKey: binding.datasetKey }));
      }
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
