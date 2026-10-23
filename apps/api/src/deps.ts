import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import type { Logger } from './lib/logger.js';
import type { EventPublisher } from './realtime/publisher.js';

/**
 * Everything a service needs, passed in explicitly instead of imported as
 * globals. The API, the worker and the tests each build this themselves
 * (tests, for example, use a test database and a recording publisher).
 */
export interface Deps {
  config: Config;
  prisma: PrismaClient;
  logger: Logger;
  publisher: EventPublisher;
}
