import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import type { Deps } from './deps.js';
import { createLogger } from './lib/logger.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV);
  const prisma = createPrisma(config);
  await prisma.$connect();

  const deps: Deps = { config, prisma, logger };
  const server = createServer(createApp(deps));

  server.listen(config.PORT, () => {
    logger.info(`API listening on port ${config.PORT}`);
  });

  // Graceful shutdown: stop accepting connections, let in-flight requests
  // finish, then close the database pool. Docker sends SIGTERM on stop.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
