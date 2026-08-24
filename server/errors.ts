import type { ErrorRequestHandler, RequestHandler } from 'express';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const parserError = error as { status?: number; type?: string; body?: unknown };
  if (parserError.type === 'entity.too.large') {
    response.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'The request exceeds the 11 MB service limit.' } });
    return;
  }
  if (error instanceof SyntaxError && parserError.status === 400 && parserError.type === 'entity.parse.failed') {
    response.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body must be valid JSON.' } });
    return;
  }
  const known = error instanceof AppError;
  if ((error as { name?: string }).name === 'MulterError') {
    response.status(413).json({ error: { code: 'ARTIFACT_TOO_LARGE', message: 'The upload exceeds the size limit.' } });
    return;
  }
  const status = known ? error.status : 500;
  const code = known ? error.code : 'INTERNAL_ERROR';
  const message = known ? error.message : 'The service could not complete the request.';
  if (!known) console.error(JSON.stringify({ event: 'request.failed', status, code }));
  response.status(status).json({ error: { code, message } });
};

export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
