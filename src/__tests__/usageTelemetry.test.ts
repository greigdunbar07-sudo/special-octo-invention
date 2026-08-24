import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recordUsageEvents: vi.fn() }));
vi.mock('@/services/portalApi', () => ({ portalApi: { recordUsageEvents: mocks.recordUsageEvents } }));

describe('usage telemetry queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    sessionStorage.clear();
    mocks.recordUsageEvents.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('batches events after five seconds without adding arbitrary data', async () => {
    const { usageTelemetry } = await import('@/services/usageTelemetry');
    usageTelemetry.configure(true);
    usageTelemetry.track({ eventType: 'catalog_searched', resultCount: 2, kindFilter: 'all', filterCount: 0 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.recordUsageEvents).toHaveBeenCalledTimes(1);
    const event = mocks.recordUsageEvents.mock.calls[0][0][0];
    expect(event).toMatchObject({ eventType: 'catalog_searched', resultCount: 2, kindFilter: 'all', filterCount: 0 });
    expect(event).not.toHaveProperty('query');
  });

  it('retries a server failure once and keeps the same id', async () => {
    const { ApiError } = await import('@/services/HttpPortalApi');
    mocks.recordUsageEvents.mockRejectedValueOnce(new ApiError('INTERNAL_ERROR', 'failed', 500)).mockResolvedValueOnce(undefined);
    const { usageTelemetry } = await import('@/services/usageTelemetry');
    usageTelemetry.configure(true);
    usageTelemetry.track({ eventType: 'portal_session_started' });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.recordUsageEvents).toHaveBeenCalledTimes(2);
    expect(mocks.recordUsageEvents.mock.calls[1][0][0].id).toBe(mocks.recordUsageEvents.mock.calls[0][0][0].id);
  });

  it('drops events while collection is disabled', async () => {
    const { usageTelemetry } = await import('@/services/usageTelemetry');
    usageTelemetry.configure(false);
    usageTelemetry.track({ eventType: 'portal_session_started' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.recordUsageEvents).not.toHaveBeenCalled();
  });
});
