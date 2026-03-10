/**
 * Request Logger Middleware — Structured request/response logging.
 *
 * Generates a UUID correlation ID per request, attaches it to
 * `(req as any).correlationId`, and logs method, path, status code,
 * and duration in milliseconds using the ops-core structured logger.
 */

import * as http from 'http';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@ai-ops/ops-core';

const log = createLogger('request-logger');

/**
 * Express-style middleware that logs incoming requests and their responses.
 *
 * @param req  - Node.js IncomingMessage
 * @param res  - Node.js ServerResponse
 * @param next - Callback to continue request processing
 */
export function requestLogger(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
): void {
  const correlationId = randomUUID();
  (req as any).correlationId = correlationId;

  const start = Date.now();
  const method = req.method || 'GET';
  const path = (req.url || '/').split('?')[0];

  // Hook into response finish to log with final status code and duration
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;

    log.info('request completed', {
      method,
      path,
      statusCode,
      durationMs,
    }, correlationId);
  });

  next();
}
