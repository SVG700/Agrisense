/**
 * 404 + centralised error handling. Every error leaves as JSON:
 *   { error: string, code: string, details?: any, request_id }
 */
import { HttpError, StoreError } from '../utils/validate.js';

export function notFound(req, _res, next) {
  next(new HttpError(404, `Route ${req.method} ${req.path} not found`, { code: 'route_not_found' }));
}

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error';
    let details;

    if (err instanceof HttpError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof StoreError) {
      status = 503;
      code = 'database_unavailable';
      message = 'The database is unavailable; nothing was saved. Retry later.';
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      code = 'invalid_json';
      message = 'Request body is not valid JSON';
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      code = 'payload_too_large';
      message = 'Request body too large';
    } else if (err?.message?.startsWith('Origin ')) {
      status = 403;
      code = 'cors_rejected';
      message = err.message;
    }

    if (status >= 500) {
      logger.error('request_failed', {
        request_id: req.id,
        path: req.path,
        code,
        error: err?.message,
        cause: err?.cause?.message,
      });
    }

    res.status(status).json({ error: message, code, ...(details ? { details } : {}), request_id: req.id });
  };
}
