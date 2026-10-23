import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, resetDatabase, setupOrgWithRoles } from './helpers.js';

const { app, prisma } = createTestContext();

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

type Org = Awaited<ReturnType<typeof setupOrgWithRoles>>;

async function createTicket(org: Org, body: Record<string, unknown> = {}) {
  const res = await org.asAdmin
    .post('/api/tickets')
    .send({ title: 'Printer on fire', priority: 'medium', ...body })
    .expect(201);
  return res.body.ticket as { id: string; status: string; assignee: { id: string } | null };
}

describe('creating tickets', () => {
  it('lets Admins and Agents create tickets, recording the author from the session', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const res = await org.asAgent
      .post('/api/tickets')
      .send({ title: 'VPN down', description: 'Since 9am', priority: 'high' })
      .expect(201);
    expect(res.body.ticket).toMatchObject({
      title: 'VPN down',
      status: 'open',
      priority: 'high',
      createdBy: { id: org.agent, name: 'agent' },
      assignee: null,
    });
  });

  it('forbids Viewers from creating tickets', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    await org.asViewer.post('/api/tickets').send({ title: 'Nope' }).expect(403);
  });

  it('ignores attempts to set the organization or author in the body', async () => {
    const acme = await setupOrgWithRoles(app, 'Acme');
    const globex = await setupOrgWithRoles(app, 'Globex');
    await acme.asAdmin
      .post('/api/tickets')
      .send({ title: 'Sneaky', organizationId: globex.orgId, createdById: globex.adminId })
      .expect(201);
    expect(await prisma.ticket.count({ where: { organizationId: globex.orgId } })).toBe(0);
  });
});

describe('listing tickets', () => {
  it('filters by status, priority and assignee and paginates newest first', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const a = await createTicket(org, { title: 'A', priority: 'low' });
    await createTicket(org, { title: 'B', priority: 'urgent', assigneeId: org.agent });
    await createTicket(org, { title: 'C', priority: 'urgent' });
    await org.asAdmin.patch(`/api/tickets/${a.id}`).send({ status: 'in_progress' }).expect(200);

    const urgent = await org.asAdmin.get('/api/tickets?priority=urgent').expect(200);
    expect(urgent.body.data.map((t: { title: string }) => t.title)).toEqual(['C', 'B']);

    const inProgress = await org.asAdmin.get('/api/tickets?status=in_progress').expect(200);
    expect(inProgress.body.data.map((t: { title: string }) => t.title)).toEqual(['A']);

    const mine = await org.asAgent.get('/api/tickets?assigneeId=me').expect(200);
    expect(mine.body.data.map((t: { title: string }) => t.title)).toEqual(['B']);

    const unassigned = await org.asAdmin.get('/api/tickets?assigneeId=unassigned').expect(200);
    expect(unassigned.body.total).toBe(2);

    const page2 = await org.asAdmin.get('/api/tickets?page=2&pageSize=2').expect(200);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.body.data.map((t: { title: string }) => t.title)).toEqual(['A']);
  });

  it('rejects invalid filters with 400', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    await org.asAdmin.get('/api/tickets?status=banana').expect(400);
    await org.asAdmin.get('/api/tickets?pageSize=1000').expect(400);
  });
});

describe('tenant isolation', () => {
  it("never shows or changes another organization's tickets or comments", async () => {
    const acme = await setupOrgWithRoles(app, 'Acme');
    const globex = await setupOrgWithRoles(app, 'Globex');
    const ticket = await createTicket(acme);

    const list = await globex.asAdmin.get('/api/tickets').expect(200);
    expect(list.body.total).toBe(0);

    await globex.asAdmin.get(`/api/tickets/${ticket.id}`).expect(404);
    await globex.asAdmin.patch(`/api/tickets/${ticket.id}`).send({ status: 'closed' }).expect(404);
    await globex.asAdmin.get(`/api/tickets/${ticket.id}/comments`).expect(404);
    await globex.asAdmin
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'hi' })
      .expect(404);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.status).toBe('open');
    expect(await prisma.comment.count()).toBe(0);
  });

  it("refuses to assign a ticket to another organization's user", async () => {
    const acme = await setupOrgWithRoles(app, 'Acme');
    const globex = await setupOrgWithRoles(app, 'Globex');
    const ticket = await createTicket(acme);
    const res = await acme.asAdmin
      .patch(`/api/tickets/${ticket.id}`)
      .send({ assigneeId: globex.agent })
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
  });
});

describe('updating tickets', () => {
  it('lets an Agent claim an unassigned ticket and work it', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    await org.asAgent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ assigneeId: org.agent, status: 'in_progress' })
      .expect(200);
    const res = await org.asAgent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ status: 'resolved', priority: 'low' })
      .expect(200);
    expect(res.body.ticket).toMatchObject({ status: 'resolved', priority: 'low' });
  });

  it('forbids an Agent from changing a ticket assigned to someone else', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org, { assigneeId: org.agent2 });
    await org.asAgent.patch(`/api/tickets/${ticket.id}`).send({ priority: 'low' }).expect(403);
  });

  it('lets Admins update any ticket but never Viewers', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org, { assigneeId: org.agent2 });
    await org.asAdmin.patch(`/api/tickets/${ticket.id}`).send({ priority: 'low' }).expect(200);
    await org.asViewer.patch(`/api/tickets/${ticket.id}`).send({ priority: 'high' }).expect(403);
  });

  it('enforces status transitions and freezes closed tickets', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);

    const invalid = await org.asAdmin
      .patch(`/api/tickets/${ticket.id}`)
      .send({ status: 'resolved' })
      .expect(422);
    expect(invalid.body.error.code).toBe('INVALID_TRANSITION');

    await org.asAdmin.patch(`/api/tickets/${ticket.id}`).send({ status: 'closed' }).expect(200);
    const frozen = await org.asAdmin
      .patch(`/api/tickets/${ticket.id}`)
      .send({ status: 'in_progress' })
      .expect(409);
    expect(frozen.body.error.code).toBe('TICKET_CLOSED');
  });

  it('refuses to assign tickets to Viewers', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    await org.asAdmin
      .patch(`/api/tickets/${ticket.id}`)
      .send({ assigneeId: org.viewer })
      .expect(422);
  });

  it('rejects unknown fields instead of silently ignoring them', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    await org.asAdmin
      .patch(`/api/tickets/${ticket.id}`)
      .send({ organizationId: org.orgId })
      .expect(400);
  });

  it('refuses a write based on a stale read (optimistic concurrency)', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    // Two agents race to claim the same unassigned ticket.
    const results = await Promise.all([
      org.asAgent.patch(`/api/tickets/${ticket.id}`).send({ assigneeId: org.agent }),
      org.asAgent2.patch(`/api/tickets/${ticket.id}`).send({ assigneeId: org.agent2 }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // Whatever the timing, at most one claim wins; the other gets 403 (it
    // read the ticket after the claim) or 409 (it read it before).
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect([403, 409]).toContain(statuses.find((s) => s !== 200));
  });
});

describe('comments', () => {
  it('lets Admins and Agents comment and lists comments oldest first', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    await org.asAgent
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'First' })
      .expect(201);
    await org.asAdmin
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'Second' })
      .expect(201);

    const res = await org.asViewer.get(`/api/tickets/${ticket.id}/comments`).expect(200);
    expect(res.body.data.map((c: { body: string }) => c.body)).toEqual(['First', 'Second']);
    expect(res.body.data[0].author).toEqual({ id: org.agent, name: 'agent' });
  });

  it('forbids Viewers from commenting', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    await org.asViewer.post(`/api/tickets/${ticket.id}/comments`).send({ body: 'Hi' }).expect(403);
  });

  it('does not accept comments on closed tickets', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    await org.asAdmin.patch(`/api/tickets/${ticket.id}`).send({ status: 'closed' }).expect(200);
    await org.asAdmin.post(`/api/tickets/${ticket.id}/comments`).send({ body: 'Hi' }).expect(409);
  });

  it('rejects empty comments', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org);
    await org.asAdmin.post(`/api/tickets/${ticket.id}/comments`).send({ body: '   ' }).expect(400);
  });
});
