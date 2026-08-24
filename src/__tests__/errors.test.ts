// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError, asyncRoute, errorHandler } from '../../server/errors';

describe('server error handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a structured failure without logging exception or SQL details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/failure', asyncRoute(async () => {
      throw new Error("Violation of UNIQUE KEY constraint 'UQ_PortalUser_Email'. Server=tcp:private.database.windows.net");
    }));
    app.use(errorHandler);

    const response = await request(app).get('/failure').expect(500);

    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'The service could not complete the request.' } });
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'request.failed', status: 500, code: 'INTERNAL_ERROR' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('UQ_PortalUser_Email');
    expect(JSON.stringify(log.mock.calls)).not.toContain('database.windows.net');
  });

  it('preserves application 400 errors instead of mislabelling them as invalid JSON', async () => {
    const app = express();
    app.get('/failure', asyncRoute(async () => {
      throw new AppError(400, 'INVALID_ARTIFACT', 'The artifact could not be packaged.');
    }));
    app.use(errorHandler);

    const response = await request(app).get('/failure').expect(400);

    expect(response.body).toEqual({ error: { code: 'INVALID_ARTIFACT', message: 'The artifact could not be packaged.' } });
  });

  it('still returns the safe invalid JSON error for malformed JSON bodies', async () => {
    const app = express();
    app.use(express.json());
    app.post('/json', (_request, response) => response.status(204).end());
    app.use(errorHandler);

    const response = await request(app)
      .post('/json')
      .set('Content-Type', 'application/json')
      .send('{not-json')
      .expect(400);

    expect(response.body).toEqual({ error: { code: 'INVALID_JSON', message: 'The request body must be valid JSON.' } });
  });
});
