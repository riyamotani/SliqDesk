import { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';

/** One client per process; Prisma keeps a connection pool inside it. */
export function createPrisma(config: Config): PrismaClient {
  return new PrismaClient({ datasourceUrl: config.DATABASE_URL });
}
