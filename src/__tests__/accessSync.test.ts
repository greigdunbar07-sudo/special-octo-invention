import { describe, expect, it, vi } from 'vitest';

import { runAccessSyncBatch } from '@/services/accessSync';

describe('runAccessSyncBatch', () => {
  it('uses bounded concurrency for large materialisation jobs', async () => {
    let active = 0;
    let maximumActive = 0;

    await runAccessSyncBatch(Array.from({ length: 18 }, (_, index) => index), async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => window.setTimeout(resolve, 5));
      active -= 1;
    }, { concurrency: 4, retryDelaysMs: [] });

    expect(maximumActive).toBe(4);
  });

  it('retries transient service failures and completes the item once', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('503 Service unavailable'))
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValue(undefined);

    await runAccessSyncBatch(['report-chunk'], operation, { concurrency: 1, retryDelaysMs: [0, 0] });

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry validation or permission failures', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Create permission is denied'));

    await expect(runAccessSyncBatch(['report-chunk'], operation, { retryDelaysMs: [0, 0] }))
      .rejects.toThrow('Create permission is denied');
    expect(operation).toHaveBeenCalledOnce();
  });
});
