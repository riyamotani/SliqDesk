import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-database-url.js';

/**
 * Runs once before all integration tests: applies the migrations to the test
 * schema so it always matches prisma/schema.prisma.
 *
 * DATABASE_URL is passed explicitly: global setup runs outside the test
 * workers, so the project's `env` setting doesn't reach it, and Prisma would
 * otherwise fall back to the development database from .env.
 */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
