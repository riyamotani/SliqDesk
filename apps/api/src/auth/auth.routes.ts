import { loginSchema, signupSchema } from '@sliqdesk/shared';
import { Router } from 'express';
import type { Deps } from '../deps.js';
import { validate } from '../lib/validate.js';
import * as auth from './auth.service.js';
import { authenticate, getAuth } from './authenticate.js';
import { SESSION_COOKIE, sessionCookieOptions } from './token.js';

export function authRouter(deps: Deps): Router {
  const router = Router();
  const cookieOptions = sessionCookieOptions(deps.config);

  router.post('/signup', async (req, res) => {
    const input = validate(signupSchema, req.body);
    const result = await auth.signup(deps, input);
    res.cookie(SESSION_COOKIE, result.token, cookieOptions);
    res.status(201).json({ user: auth.toCurrentUser(result.auth) });
  });

  router.post('/login', async (req, res) => {
    const input = validate(loginSchema, req.body);
    const result = await auth.login(deps, input);
    res.cookie(SESSION_COOKIE, result.token, cookieOptions);
    res.json({ user: auth.toCurrentUser(result.auth) });
  });

  // Logout always succeeds and clears the cookie; if the session is still
  // valid it is also revoked server-side.
  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token !== '') {
      const session = await auth.resolveSession(deps, token);
      if (session) await auth.logout(deps, session.id);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', authenticate(deps), (req, res) => {
    res.json({ user: auth.toCurrentUser(getAuth(req)) });
  });

  return router;
}
