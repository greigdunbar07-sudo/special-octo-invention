import type { RequestHandler } from 'express';

import { AppError } from './errors.js';

export const PORTAL_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'none'",
].join('; ');

interface RateLimitOptions {
  max: number;
  windowMs: number;
  key: (request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => string;
  message?: string;
}

interface Counter {
  count: number;
  resetAt: number;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const counters = new Map<string, Counter>();
  return (request, response, next) => {
    const now = Date.now();
    const key = options.key(request, response);
    const current = counters.get(key);
    const counter = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
    counter.count += 1;
    counters.set(key, counter);
    response.setHeader('RateLimit-Limit', String(options.max));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, options.max - counter.count)));
    response.setHeader('RateLimit-Reset', String(Math.ceil(counter.resetAt / 1000)));
    if (counter.count > options.max) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((counter.resetAt - now) / 1000))));
      next(new AppError(429, 'RATE_LIMITED', options.message ?? 'Too many upload requests. Wait before trying again.'));
      return;
    }
    if (counters.size > 1000) {
      for (const [candidate, value] of counters) if (value.resetAt <= now) counters.delete(candidate);
    }
    next();
  };
}

interface ConcurrencyOptions {
  max: number;
  key: (request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => string;
  message?: string;
}

export function concurrencyLimit(options: ConcurrencyOptions): RequestHandler {
  const active = new Map<string, number>();
  return (request, response, next) => {
    const key = options.key(request, response);
    const count = active.get(key) ?? 0;
    if (count >= options.max) {
      response.setHeader('Retry-After', '5');
      next(new AppError(429, 'UPLOAD_BUSY', options.message ?? 'Another upload is already being processed. Try again shortly.'));
      return;
    }
    active.set(key, count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (active.get(key) ?? 1) - 1;
      if (remaining <= 0) active.delete(key); else active.set(key, remaining);
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  };
}

export function contentLengthLimit(maxBytes: number, message = 'The combined upload exceeds the service limit.', code = 'UPLOAD_TOO_LARGE'): RequestHandler {
  return (request, _response, next) => {
    const value = request.get('content-length');
    const length = value ? Number(value) : 0;
    if (Number.isFinite(length) && length > maxBytes) {
      next(new AppError(413, code, message));
      return;
    }
    next();
  };
}
