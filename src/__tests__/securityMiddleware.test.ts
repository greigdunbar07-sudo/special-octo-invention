// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../../server/errors';
import { contentLengthLimit, PORTAL_CONTENT_SECURITY_POLICY, rateLimit } from '../../server/security';

describe('HTTP abuse protections', () => {
  it('defines a restrictive portal CSP that still permits same-origin Vite assets', () => {
    expect(PORTAL_CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(PORTAL_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(PORTAL_CONTENT_SECURITY_POLICY).toContain("script-src-attr 'none'");
    expect(PORTAL_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(PORTAL_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  it('rate limits repeated upload attempts with a retry contract', async () => {
    const app = express();
    app.post('/upload', rateLimit({ max: 2, windowMs: 60_000, key: () => 'admin-1' }), (_request, response) => response.status(204).end());
    app.use(errorHandler);
    await request(app).post('/upload').expect(204);
    await request(app).post('/upload').expect(204);
    const blocked = await request(app).post('/upload').expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.message).toBe('Too many upload requests. Wait before trying again.');
  });

  it('lets catalog routes use their own rate-limit copy', async () => {
    const app = express();
    app.get('/qlik', rateLimit({ max: 1, windowMs: 60_000, key: () => 'admin-1', message: 'Too many Qlik catalog requests. Wait before trying again.' }), (_request, response) => response.status(204).end());
    app.use(errorHandler);
    await request(app).get('/qlik').expect(204);
    const blocked = await request(app).get('/qlik').expect(429);
    expect(blocked.body.error.message).toBe('Too many Qlik catalog requests. Wait before trying again.');
  });

  it('rejects an oversized declared multipart body before buffering it', async () => {
    const app = express();
    app.post('/upload', contentLengthLimit(10), (_request, response) => response.status(204).end());
    app.use(errorHandler);
    const blocked = await request(app).post('/upload').set('Content-Length', '11').expect(413);
    expect(blocked.body.error.code).toBe('UPLOAD_TOO_LARGE');
  });
});
