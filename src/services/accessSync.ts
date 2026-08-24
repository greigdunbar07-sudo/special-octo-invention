const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRY_DELAYS_MS = [250, 750] as const;

interface BatchOptions {
  concurrency?: number;
  retryDelaysMs?: readonly number[];
}

function isTransientFailure(value: unknown): boolean {
  const status = value && typeof value === 'object' && 'status' in value
    ? Number((value as { status?: unknown }).status)
    : 0;
  if (status === 408 || status === 429 || status >= 500) return true;
  const message = value instanceof Error ? value.message : String(value);
  return /fetch|network|temporar|timeout|timed out|connection|429|50[234]/i.test(message);
}

async function runWithRetry<T>(operation: () => Promise<T>, retryDelaysMs: readonly number[]): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (caught) {
      if (attempt >= retryDelaysMs.length || !isTransientFailure(caught)) throw caught;
      await new Promise((resolve) => window.setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }
}

/** Runs high-volume access updates with a bounded concurrency limit. */
export async function runAccessSyncBatch<T>(
  items: readonly T[],
  operation: (item: T) => Promise<unknown>,
  options: BatchOptions = {},
): Promise<void> {
  if (!items.length) return;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const failures: unknown[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await runWithRetry(() => operation(item), retryDelaysMs);
      } catch (caught) {
        failures.push(caught);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${failures.length} access records could not be synchronised.`);
}
