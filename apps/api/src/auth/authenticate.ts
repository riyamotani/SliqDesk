import type { Request, RequestHandler } from 'express';
import type { Deps } from '../deps.js';
import { unauthorized } from '../lib/errors.js';
import { resolveSession, type AuthContext } from './auth.service.js';
import { SESSION_COOKIE } from './token.js';

// Adds `req.auth` to Express's Request type.
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** Rejects the request with 401 unless it carries a valid, unrevoked session cookie. */
export function authenticate(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token === '') throw unauthorized();

    const auth = await resolveSession(deps, token);
    if (!auth) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      throw unauthorized('Your session has expired. Please log in again.');
    }

    req.auth = auth;
    next();
  };
}

/** The authenticated user of a request that passed `authenticate`. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
