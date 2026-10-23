import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPrisma } from '../src/db.js';
import type { Deps } from '../src/deps.js';
import { createLogger } from '../src/lib/logger.js';
import { createRecordingPublisher } from '../src/realtime/publisher.js';
import { createRecordingScheduler } from '../src/sla/sla.queue.js';

/**
 * Real app wired to the test database, plus a supertest client for it.
 * Real-time events are recorded (not sent) so tests can assert on them.
 */
export function createTestContext() {
  const config = loadConfig();
  const prisma = createPrisma(config);
  const recorder = createRecordingPublisher();
  const sla = createRecordingScheduler();
  const deps: Deps = {
    config,
    prisma,
    logger: createLogger('silent', 'test'),
    publisher: recorder.publisher,
    slaScheduler: sla.scheduler,
  };
  const app = createApp(deps);
  return { deps, prisma, app, request: supertest(app), recorder, sla };
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

/**
 * An organization with one logged-in user per role. Emails are
 * `<role>@<prefix>.test`, password "password123".
 */
export async function setupOrgWithRoles(app: ReturnType<typeof createApp>, prefix: string) {
  const { agent: admin, user } = await signupOrg(app, prefix);
  const domain = `${prefix.toLowerCase()}.test`;
  const ids: Record<'agent' | 'agent2' | 'viewer', string> = { agent: '', agent2: '', viewer: '' };
  for (const [key, role] of [
    ['agent', 'agent'],
    ['agent2', 'agent'],
    ['viewer', 'viewer'],
  ] as const) {
    const res = await admin
      .post('/api/members')
      .send({ name: key, email: `${key}@${domain}`, role, password: 'password123' })
      .expect(201);
    ids[key] = res.body.member.id;
  }
  return {
    orgId: user.organization.id,
    adminId: user.id,
    ...ids,
    asAdmin: admin,
    asAgent: await loginAs(app, `agent@${domain}`, 'password123'),
    asAgent2: await loginAs(app, `agent2@${domain}`, 'password123'),
    asViewer: await loginAs(app, `viewer@${domain}`, 'password123'),
  };
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
