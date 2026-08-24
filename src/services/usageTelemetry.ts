import type { UsageEventInput } from '@/types/portal';
import { ApiError } from './HttpPortalApi';
import { portalApi } from './portalApi';

type UsageEventDraft = Omit<UsageEventInput, 'id' | 'sessionId' | 'occurredAt'>;

const SESSION_KEY = 'covetrus.launchpad.usage-session';
const STARTED_KEY = 'covetrus.launchpad.usage-session-started';
const FLUSH_MS = 5_000;
const RETRY_MS = 15_000;
const MAX_BATCH = 25;

function randomId() {
  return crypto.randomUUID();
}

function sessionValue(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function setSessionValue(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* Telemetry remains in-memory when storage is unavailable. */ }
}

class UsageTelemetry {
  private enabled = false;
  private queue: UsageEventInput[] = [];
  private sending = false;
  private flushTimer: number | null = null;
  private retryTimer: number | null = null;
  private readonly sessionId: string;

  constructor() {
    this.sessionId = sessionValue(SESSION_KEY) || randomId();
    setSessionValue(SESSION_KEY, this.sessionId);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) void this.flush(); });
      window.addEventListener('pagehide', () => void this.flush());
    }
  }

  configure(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.queue = [];
      if (this.flushTimer != null) window.clearTimeout(this.flushTimer);
      if (this.retryTimer != null) window.clearTimeout(this.retryTimer);
      this.flushTimer = null; this.retryTimer = null;
    }
  }

  startSession() {
    if (!this.enabled || sessionValue(STARTED_KEY) === this.sessionId) return;
    setSessionValue(STARTED_KEY, this.sessionId);
    this.track({ eventType: 'portal_session_started' });
  }

  track(draft: UsageEventDraft) {
    if (!this.enabled) return;
    this.queue.push({ ...draft, id: randomId(), sessionId: this.sessionId, occurredAt: new Date().toISOString() });
    if (this.queue.length >= 10) void this.flush();
    else this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer != null) return;
    this.flushTimer = window.setTimeout(() => { this.flushTimer = null; void this.flush(); }, FLUSH_MS);
  }

  async flush() {
    if (!this.enabled || this.sending || this.queue.length === 0) return;
    if (this.flushTimer != null) window.clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const batch = this.queue.splice(0, MAX_BATCH);
    this.sending = true;
    try {
      await portalApi.recordUsageEvents(batch);
    } catch (caught) {
      if (this.retryable(caught)) this.scheduleRetry(batch);
    } finally {
      this.sending = false;
      if (this.queue.length > 0) this.scheduleFlush();
    }
  }

  private scheduleRetry(batch: UsageEventInput[]) {
    if (!this.enabled || this.retryTimer != null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void portalApi.recordUsageEvents(batch).catch(() => { /* Drop after one retry. */ });
    }, RETRY_MS);
  }

  private retryable(caught: unknown) {
    return !(caught instanceof ApiError) || caught.status === 429 || caught.status >= 500;
  }
}

export const usageTelemetry = new UsageTelemetry();
