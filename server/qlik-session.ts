import { AppError } from './errors.js';
import { openQlikEngineApp, type QlikEngineSession, type QlikExtractOptions } from './qlik-extract.js';

const DEFAULT_IDLE_MS = 3 * 60_000;
const DEFAULT_MAX_APPS = 2;

interface CachedApp {
  appId: string;
  session: QlikEngineSession;
  appHandle: number;
  lastUsed: number;
  busy: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class QlikAppSessionCache {
  private readonly apps = new Map<string, CachedApp>();
  private readonly idleMs: number;
  private readonly maxApps: number;

  constructor(
    private readonly connect: (appId: string) => Promise<{ session: QlikEngineSession; appHandle: number }>,
    options: { idleMs?: number; maxApps?: number } = {},
  ) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.maxApps = options.maxApps ?? DEFAULT_MAX_APPS;
  }

  static fromExtractOptions(options: Pick<QlikExtractOptions, 'tenantUrl' | 'apiKey' | 'fetchImpl' | 'openSession'>, limits?: { idleMs?: number; maxApps?: number }): QlikAppSessionCache {
    return new QlikAppSessionCache(
      (appId) => openQlikEngineApp({ ...options, appId }),
      limits,
    );
  }

  async run<T>(appId: string, work: (session: QlikEngineSession, appHandle: number) => Promise<T>): Promise<T> {
    const cached = await this.acquire(appId);
    if (!cached) {
      const opened = await this.connect(appId);
      try { return await work(opened.session, opened.appHandle); }
      finally { opened.session.close(); }
    }
    cached.busy += 1;
    this.clearIdle(cached);
    try {
      const result = await work(cached.session, cached.appHandle);
      cached.lastUsed = Date.now();
      return result;
    } catch (error) {
      if (error instanceof AppError && (error.code === 'QLIK_UNAVAILABLE' || error.code === 'QLIK_ENGINE_ERROR' || error.code === 'QLIK_AUTH_FAILED')) {
        this.evict(appId);
      }
      throw error;
    } finally {
      cached.busy -= 1;
      if (cached.busy <= 0 && this.apps.get(appId) === cached) this.scheduleIdle(cached);
    }
  }

  closeAll(): void {
    for (const appId of [...this.apps.keys()]) this.evict(appId);
  }

  private async acquire(appId: string): Promise<CachedApp | null> {
    const existing = this.apps.get(appId);
    if (existing) return existing;
    if (this.apps.size >= this.maxApps) {
      const idle = [...this.apps.values()].filter((item) => item.busy === 0).sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (idle) this.evict(idle.appId);
    }
    if (this.apps.size >= this.maxApps) return null;
    const opened = await this.connect(appId);
    const cached: CachedApp = { appId, session: opened.session, appHandle: opened.appHandle, lastUsed: Date.now(), busy: 0 };
    this.apps.set(appId, cached);
    return cached;
  }

  private scheduleIdle(cached: CachedApp): void {
    this.clearIdle(cached);
    cached.idleTimer = setTimeout(() => {
      if (cached.busy > 0) return;
      this.evict(cached.appId);
    }, this.idleMs);
    cached.idleTimer.unref?.();
  }

  private clearIdle(cached: CachedApp): void {
    if (cached.idleTimer) clearTimeout(cached.idleTimer);
    cached.idleTimer = undefined;
  }

  private evict(appId: string): void {
    const cached = this.apps.get(appId);
    if (!cached) return;
    this.clearIdle(cached);
    this.apps.delete(appId);
    try { cached.session.close(); } catch { /* already closed */ }
  }
}
