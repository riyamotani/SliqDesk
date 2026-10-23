import { createServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import type { Deps } from './deps.js';
import { createLogger } from './lib/logger.js';
import { createSocketPublisher } from './realtime/publisher.js';
import { createSocketServer } from './realtime/socket.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV);
  const prisma = createPrisma(config);
  await prisma.$connect();

  // Redis pub/sub for Socket.IO: an event emitted on any API instance (or by
  // the worker) is relayed to clients connected to every instance.
  const redisPub = new Redis(config.REDIS_URL);
  const redisSub = redisPub.duplicate();

  const httpServer = createServer();
  const io = createSocketServer(
    httpServer,
    { config, prisma, logger },
    createAdapter(redisPub, redisSub),
  );
  const deps: Deps = { config, prisma, logger, publisher: createSocketPublisher(io) };
  httpServer.on('request', createApp(deps));

  httpServer.listen(config.PORT, () => {
    logger.info(`API listening on port ${config.PORT}`);
  });

  // Graceful shutdown: stop accepting connections, let in-flight requests
  // finish, then close Redis and the database pool. Docker sends SIGTERM on stop.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    void io.close(() => {
      redisPub.disconnect();
      redisSub.disconnect();
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
