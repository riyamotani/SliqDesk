import type { ApiError } from '@sliqdesk/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

/** Any /api route that didn't match. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
};

/**
 * Turns every thrown error into the same JSON shape. Expected errors
 * (AppError) keep their status and message; anything else becomes a generic
 * 500 so internal details (stack traces, SQL) never reach the client.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      const body: ApiError = { error: { code: err.code, message: err.message } };
      if (err.details !== undefined) body.error.details = err.details;
      res.status(err.status).json(body);
      return;
    }

    // Malformed JSON or oversized body, raised by express.json().
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const status = err.type === 'entity.too.large' ? 413 : 400;
      const body: ApiError = { error: { code: 'BAD_REQUEST', message: 'Invalid request body' } };
      res.status(status).json(body);
      return;
    }

    logger.error({ err }, 'Unhandled error');
    const body: ApiError = { error: { code: 'INTERNAL', message: 'Something went wrong' } };
    res.status(500).json(body);
  };
}
