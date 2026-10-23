import type { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import type { Config } from '../config.js';

export const SESSION_COOKIE = 'sliqdesk_session';

/**
 * The token only identifies the user (`sub`) and carries their tokenVersion
 * (`ver`). Role and organization are NOT in the token: they are loaded from
 * the database on every request, so changes apply immediately.
 */
export interface TokenPayload {
  userId: string;
  tokenVersion: number;
}

export function signToken(config: Config, payload: TokenPayload): string {
  return jwt.sign({ ver: payload.tokenVersion }, config.JWT_SECRET, {
    subject: payload.userId,
    expiresIn: `${config.JWT_TTL_HOURS}h`,
    algorithm: 'HS256',
  });
}

/** Returns the payload, or null if the token is invalid, tampered with or expired. */
export function verifyToken(config: Config, token: string): TokenPayload | null {
  try {
    // Pinning the algorithm rejects tokens that claim a different one
    // (e.g. the classic "alg: none" attack).
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string') return null;
    if (typeof decoded.ver !== 'number') return null;
    return { userId: decoded.sub, tokenVersion: decoded.ver };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(config: Config): CookieOptions {
  return {
    httpOnly: true, // not readable from JavaScript, so XSS can't steal it
    sameSite: 'lax', // not sent on cross-site POSTs, which blocks CSRF
    secure: config.COOKIE_SECURE, // HTTPS-only in production
    path: '/',
    maxAge: config.JWT_TTL_HOURS * 60 * 60 * 1000,
  };
}
