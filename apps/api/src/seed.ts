import { PrismaClient } from '@prisma/client';
import { seed } from './seed-data.js';

/**
 * Seeds demo data. Run on every API container start (`node dist/seed.js`) and
 * locally with `npm run db:seed:dev -w @sliqdesk/api`. Safe to repeat.
 */
const prisma = new PrismaClient();

seed(prisma)
  .then((created) => {
    console.log(created ? 'Seeded demo data.' : 'Demo data already present, skipping seed.');
  })
  .catch((err) => {
    console.error('Seeding failed', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
