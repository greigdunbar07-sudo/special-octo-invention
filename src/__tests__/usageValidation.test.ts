// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseUsageEventBatch, parseUsageInsightsRange } from '../../server/usage';

const now = new Date('2026-08-23T12:00:00.000Z');
const base = {
  id: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  occurredAt: '2026-08-23T11:59:00.000Z',
};

describe('usage event validation', () => {
  it('accepts a strict search event without collecting the query', () => {
    const [event] = parseUsageEventBatch({ events: [{ ...base, eventType: 'catalog_searched', resultCount: 3, kindFilter: 'report', filterCount: 1 }] }, now);
    expect(event).toMatchObject({ eventType: 'catalog_searched', resultCount: 3, kindFilter: 'report', filterCount: 1 });
    expect(event).not.toHaveProperty('query');
  });

  it('rejects search text and other unknown fields', () => {
    expect(() => parseUsageEventBatch({ events: [{ ...base, eventType: 'catalog_searched', resultCount: 0, kindFilter: 'all', filterCount: 0, query: 'private customer name' }] }, now)).toThrow(/unsupported field/i);
  });

  it('requires an interaction and controlled error for artifact failures', () => {
    expect(() => parseUsageEventBatch({ events: [{ ...base, eventType: 'artifact_failed', artifactId: '33333333-3333-4333-8333-333333333333', durationMs: 20, errorCode: 'raw iframe error' }] }, now)).toThrow();
    const [event] = parseUsageEventBatch({ events: [{ ...base, eventType: 'artifact_failed', artifactId: '33333333-3333-4333-8333-333333333333', interactionId: '44444444-4444-4444-8444-444444444444', durationMs: 999999, errorCode: 'ARTIFACT_REPORTED_ERROR' }] }, now);
    expect(event.durationMs).toBe(300000);
  });

  it('rejects stale timestamps, client favourite events, and oversized batches', () => {
    expect(() => parseUsageEventBatch({ events: [{ ...base, occurredAt: '2026-08-20T00:00:00Z', eventType: 'portal_session_started' }] }, now)).toThrow(/timestamp/i);
    expect(() => parseUsageEventBatch({ events: [{ ...base, eventType: 'favorite_changed' }] }, now)).toThrow(/not allowed/i);
    expect(() => parseUsageEventBatch({ events: Array.from({ length: 26 }, () => ({ ...base, eventType: 'portal_session_started' })) }, now)).toThrow(/between 1 and 25/i);
  });

  it('accepts only supported insight ranges', () => {
    expect(parseUsageInsightsRange(undefined)).toBe('28d');
    expect(parseUsageInsightsRange('90d')).toBe('90d');
    expect(() => parseUsageInsightsRange('365d')).toThrow(/7d, 28d, or 90d/i);
  });
});
