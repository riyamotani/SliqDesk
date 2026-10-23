/**
 * The one place that decides which database integration tests use. Imported
 * by both vitest.config.ts (for the test workers) and global-setup.ts (which
 * runs in a separate process and does NOT receive the workers' env).
 *
 * Tests use their own Postgres schema ("test"), so they never touch
 * development data. Override with TEST_DATABASE_URL (e.g. in CI).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://sliqdesk:sliqdesk@localhost:5432/sliqdesk?schema=test';
