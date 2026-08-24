import {
  ARTIFACT_FAILURE_CODES,
  CLIENT_USAGE_EVENT_TYPES,
  type ArtifactFailureCode,
  type ClientUsageEventType,
  type UsageEventInput,
  type UsageInsightsRange,
} from '../src/types/portal.js';
import { AppError } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_TYPES = new Set<string>(CLIENT_USAGE_EVENT_TYPES);
const FAILURE_CODES = new Set<string>(ARTIFACT_FAILURE_CODES);
const BASE_FIELDS = new Set(['id', 'eventType', 'sessionId', 'occurredAt']);
const EVENT_FIELDS: Record<ClientUsageEventType, Set<string>> = {
  portal_session_started: BASE_FIELDS,
  catalog_searched: new Set([...BASE_FIELDS, 'resultCount', 'kindFilter', 'filterCount']),
  artifact_opened: new Set([...BASE_FIELDS, 'interactionId', 'artifactId']),
  artifact_ready: new Set([...BASE_FIELDS, 'interactionId', 'artifactId', 'durationMs']),
  artifact_failed: new Set([...BASE_FIELDS, 'interactionId', 'artifactId', 'durationMs', 'errorCode']),
};

export interface ValidatedUsageEvent extends UsageEventInput {
  occurredAt: string;
}

function invalid(message = 'The usage event batch is invalid.'): never {
  throw new AppError(400, 'USAGE_EVENT_INVALID', message);
}

function requiredUuid(value: unknown, field: string): string {
  const text = String(value ?? '');
  if (!UUID.test(text)) invalid(`${field} must be a UUID.`);
  return text.toLowerCase();
}

function integer(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) invalid(`${field} must be an integer.`);
  return number;
}

export function parseUsageEventBatch(body: unknown, now = new Date()): ValidatedUsageEvent[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
  const envelope = body as Record<string, unknown>;
  if (Object.keys(envelope).some((key) => key !== 'events') || !Array.isArray(envelope.events)) invalid();
  if (envelope.events.length < 1 || envelope.events.length > 25) invalid('Send between 1 and 25 usage events.');

  return envelope.events.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
    const item = raw as Record<string, unknown>;
    const eventType = String(item.eventType ?? '');
    if (!CLIENT_TYPES.has(eventType)) invalid('The usage event type is not allowed.');
    const typedEvent = eventType as ClientUsageEventType;
    if (Object.keys(item).some((key) => !EVENT_FIELDS[typedEvent].has(key))) invalid('The usage event contains an unsupported field.');

    const occurredAt = String(item.occurredAt ?? '');
    const occurredMs = Date.parse(occurredAt);
    if (!Number.isFinite(occurredMs) || occurredMs < now.getTime() - 24 * 60 * 60_000 || occurredMs > now.getTime() + 5 * 60_000) {
      invalid('The usage event timestamp is outside the accepted window.');
    }

    const parsed: ValidatedUsageEvent = {
      id: requiredUuid(item.id, 'id'),
      eventType: typedEvent,
      sessionId: requiredUuid(item.sessionId, 'sessionId'),
      occurredAt: new Date(occurredMs).toISOString(),
    };

    if (typedEvent === 'catalog_searched') {
      parsed.resultCount = Math.min(integer(item.resultCount, 'resultCount'), 1_000_000);
      parsed.filterCount = Math.min(Math.max(integer(item.filterCount, 'filterCount'), 0), 255);
      if (parsed.resultCount < 0) invalid('resultCount cannot be negative.');
      const kind = String(item.kindFilter ?? '');
      if (kind !== 'all' && kind !== 'report' && kind !== 'tool') invalid('kindFilter is invalid.');
      parsed.kindFilter = kind;
    }

    if (typedEvent.startsWith('artifact_')) {
      parsed.interactionId = requiredUuid(item.interactionId, 'interactionId');
      parsed.artifactId = requiredUuid(item.artifactId, 'artifactId');
    }

    if (typedEvent === 'artifact_ready' || typedEvent === 'artifact_failed') {
      parsed.durationMs = Math.min(Math.max(integer(item.durationMs, 'durationMs'), 0), 300_000);
    }

    if (typedEvent === 'artifact_failed') {
      const code = String(item.errorCode ?? '');
      if (!FAILURE_CODES.has(code)) invalid('errorCode is invalid.');
      parsed.errorCode = code as ArtifactFailureCode;
    }

    return parsed;
  });
}

export function parseUsageInsightsRange(value: unknown): UsageInsightsRange {
  const range = String(value ?? '28d');
  if (range !== '7d' && range !== '28d' && range !== '90d') {
    throw new AppError(400, 'USAGE_RANGE_INVALID', 'Usage insight range must be 7d, 28d, or 90d.');
  }
  return range;
}
