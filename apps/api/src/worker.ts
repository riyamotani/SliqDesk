import type { ServerToClientEvents } from '@sliqdesk/shared';
import { Emitter } from '@socket.io/redis-emitter';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { createLogger } from './lib/logger.js';
import { createEmitterPublisher } from './realtime/publisher.js';
import { flagIfOverdue, sweepOverdue } from './sla/sla.check.js';
import { SLA_QUEUE, type SlaJobData } from './sla/sla.queue.js';

/**
 * The background worker: a separate process from the API. It runs SLA checks
 * from the Redis queue, so they happen even if the API restarts or is down,
 * and it never slows down API requests.
 *
 * Two kinds of jobs share the "sla" queue:
 * - "check": a delayed job per ticket, due at its SLA deadline.
 * - "sweep": a repeating safety net that flags any overdue ticket the
 *   delayed jobs missed (e.g. Redis was unreachable when the ticket was saved).
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV);
  const prisma = createPrisma(config);
  await prisma.$connect();

  // BullMQ workers block on Redis, which requires maxRetriesPerRequest: null.
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const publisher = createEmitterPublisher(
    new Emitter<ServerToClientEvents>(new Redis(config.REDIS_URL)),
  );
  const deps = { prisma, publisher, logger };

  const worker = new Worker<SlaJobData>(
    SLA_QUEUE,
    async (job) => {
      if (job.name === 'sweep') {
        const flagged = await sweepOverdue(deps);
        if (flagged > 0) logger.info({ flagged }, 'SLA sweep flagged tickets');
        return;
      }
      await flagIfOverdue(deps, job.data);
    },
    { connection, concurrency: 5 },
  );
  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'SLA job failed'));

  // Upsert, so restarting the worker never creates duplicate schedules.
  const queue = new Queue(SLA_QUEUE, { connection });
  await queue.upsertJobScheduler(
    'sla-sweep',
    { every: config.SLA_SWEEP_SECONDS * 1000 },
    { name: 'sweep' },
  );
  // Catch up immediately on start (e.g. tickets that became overdue while down).
  await sweepOverdue(deps);
  logger.info(
    `SLA worker started (SLA ${config.SLA_MINUTES} min, sweep every ${config.SLA_SWEEP_SECONDS}s)`,
  );

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down worker`);
    setTimeout(() => process.exit(1), 10_000).unref();
    // Finish the job in progress, then close connections.
    await worker.close();
    await queue.close();
    connection.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
