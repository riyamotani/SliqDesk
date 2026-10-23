import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { authRouter } from './auth/auth.routes.js';
import type { Deps } from './deps.js';
import { errorHandler, notFoundHandler } from './http/error-handler.js';
import { membersRouter } from './members/members.routes.js';
import { ticketsRouter } from './tickets/tickets.routes.js';

/**
 * Builds the Express app without starting a server, so tests can call it
 * directly with supertest.
 */
export function createApp(deps: Deps) {
  const app = express();

  // Behind one reverse proxy (nginx in Docker): trust its X-Forwarded-* headers
  // so secure cookies and client IPs work correctly.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    pinoHttp({
      logger: deps.logger,
      // Docker polls /api/health every few seconds; logging each poll would
      // drown out real traffic. Failures still reach the error handler's log.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  // Only JSON bodies are accepted. Together with SameSite cookies this blocks
  // CSRF: a cross-site HTML form can't send application/json.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Used by the Docker healthcheck: healthy only if the database answers.
  app.get('/api/health', async (_req, res) => {
    await deps.prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter(deps));
  app.use('/api/members', membersRouter(deps));
  app.use('/api/tickets', ticketsRouter(deps));

  app.use('/api', notFoundHandler);
  app.use(errorHandler(deps.logger));

  return app;
}
