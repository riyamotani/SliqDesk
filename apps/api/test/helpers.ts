import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPrisma } from '../src/db.js';
import type { Deps } from '../src/deps.js';
import { createLogger } from '../src/lib/logger.js';

/** Real app wired to the test database, plus a supertest client for it. */
export function createTestContext() {
  const config = loadConfig();
  const prisma = createPrisma(config);
  const deps: Deps = { config, prisma, logger: createLogger('silent', 'test') };
  const app = createApp(deps);
  return { deps, prisma, app, request: supertest(app) };
}

/** Empties every table between tests. Refuses to run against a non-test database. */
export async function resetDatabase(prisma: Deps['prisma']) {
  if (!process.env.DATABASE_URL?.includes('schema=test')) {
    throw new Error('Refusing to truncate tables: DATABASE_URL is not the test schema');
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE comments, tickets, users, organizations RESTART IDENTITY CASCADE',
  );
}

/** Logs in and returns a supertest agent that keeps the session cookie. */
export async function loginAs(app: ReturnType<typeof createApp>, email: string, password: string) {
  const agent = supertest.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

/** Signs up a new organization and returns an agent that keeps its session cookie. */
export async function signupOrg(app: ReturnType<typeof createApp>, prefix: string) {
  const agent = supertest.agent(app);
  const res = await agent
    .post('/api/auth/signup')
    .send({
      organizationName: `${prefix} Inc`,
      name: `${prefix} Admin`,
      email: `admin@${prefix.toLowerCase()}.test`,
      password: 'password123',
    })
    .expect(201);
  return { agent, user: res.body.user as { id: string; organization: { id: string } } };
}
