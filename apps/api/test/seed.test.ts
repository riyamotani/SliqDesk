import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_PASSWORD, seed } from '../src/seed-data.js';
import { createTestContext, loginAs, resetDatabase } from './helpers.js';

const { app, prisma } = createTestContext();

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('seed data', () => {
  it('creates two organizations with one user per role and is safe to re-run', async () => {
    expect(await seed(prisma)).toBe(true);
    expect(await seed(prisma)).toBe(false);

    expect(await prisma.organization.count()).toBe(2);
    const users = await prisma.user.findMany({ select: { email: true, role: true } });
    expect(users.map((u) => u.email).sort()).toEqual([
      'admin@acme.test',
      'admin@globex.test',
      'agent@acme.test',
      'agent@globex.test',
      'viewer@acme.test',
      'viewer@globex.test',
    ]);
    expect(await prisma.ticket.count()).toBeGreaterThanOrEqual(6);
  });

  it('lets every documented login sign in and see only its own organization', async () => {
    await seed(prisma);
    const acme = await loginAs(app, 'viewer@acme.test', SEED_PASSWORD);
    const globex = await loginAs(app, 'admin@globex.test', SEED_PASSWORD);

    const acmeTickets = await acme.get('/api/tickets').expect(200);
    const globexTickets = await globex.get('/api/tickets').expect(200);
    const acmeIds = new Set(acmeTickets.body.data.map((t: { id: string }) => t.id));
    expect(acmeTickets.body.total).toBeGreaterThan(0);
    expect(globexTickets.body.data.some((t: { id: string }) => acmeIds.has(t.id))).toBe(false);
  });
});
