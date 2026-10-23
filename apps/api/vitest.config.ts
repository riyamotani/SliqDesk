import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-database-url.js';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        // Fast tests with no database or Redis: `npm test`
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        // Tests against a real Postgres: `npm run test:integration`
        // (run one file at a time via --no-file-parallelism in the npm script,
        // because the files share one database)
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          globalSetup: ['test/global-setup.ts'],
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: TEST_DATABASE_URL,
            JWT_SECRET: 'integration-test-secret-123',
            LOG_LEVEL: 'silent',
          },
        },
      },
    ],
  },
});
