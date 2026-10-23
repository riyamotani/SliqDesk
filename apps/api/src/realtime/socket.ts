import type { Server as HttpServer } from 'node:http';
import { orgRoom, userRoom } from '@sliqdesk/shared';
import { parse as parseCookies } from 'cookie';
import { Server, type ServerOptions } from 'socket.io';
import { resolveSession } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/token.js';
import type { Deps } from '../deps.js';
import type { SocketServer } from './publisher.js';

/**
 * Attaches Socket.IO to the HTTP server. Clients never choose what they
 * subscribe to: on connect the server authenticates the session cookie (the
 * same check as REST) and joins the socket to its own organization's room and
 * a personal room. Events are only ever emitted to those rooms.
 *
 * `adapter` is the Redis adapter in production (so emits reach clients on
 * every API instance); tests run with the default in-memory adapter.
 */
export function createSocketServer(
  httpServer: HttpServer,
  deps: Pick<Deps, 'config' | 'prisma' | 'logger'>,
  adapter?: ServerOptions['adapter'],
): SocketServer {
  const io: SocketServer = new Server(httpServer, {
    path: '/socket.io',
    // Same-origin only (the web app is served behind the same host), so no CORS.
    serveClient: false,
    ...(adapter ? { adapter } : {}),
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.request.headers.cookie ?? '');
      const token = cookies[SESSION_COOKIE];
      const auth = token ? await resolveSession(deps, token) : null;
      if (!auth) return next(new Error('UNAUTHORIZED'));
      socket.data.auth = auth;
      next();
    } catch (err) {
      deps.logger.error({ err }, 'Socket authentication failed');
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const { auth } = socket.data;
    void socket.join([orgRoom(auth.organizationId), userRoom(auth.id)]);
    deps.logger.debug({ userId: auth.id }, 'Socket connected');
  });

  return io;
}
