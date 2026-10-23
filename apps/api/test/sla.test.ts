import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { flagIfOverdue, sweepOverdue } from '../src/sla/sla.check.js';
import { createTestContext, resetDatabase, setupOrgWithRoles } from './helpers.js';

const { app, prisma, deps, recorder, sla } = createTestContext();

beforeEach(async () => {
  await resetDatabase(prisma);
  recorder.events.length = 0;
  sla.scheduled.length = 0;
});
afterAll(() => prisma.$disconnect());

type Org = Awaited<ReturnType<typeof setupOrgWithRoles>>;

async function createTicket(org: Org, priority: string) {
  const res = await org.asAgent
    .post('/api/tickets')
    .send({ title: `${priority} ticket`, priority })
    .expect(201);
  return res.body.ticket as { id: string; slaDueAt: string | null };
}

/** Moves a ticket's deadline into the past, as if SLA_MINUTES had elapsed. */
async function expireDeadline(ticketId: string) {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { slaDueAt: new Date(Date.now() - 1000) },
  });
}

const breachEvents = () => recorder.events.filter((e) => e.event === 'ticket.sla_breached');

describe('SLA deadlines', () => {
  it('starts the clock and queues a check for high and urgent tickets only', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const before = Date.now();
    const high = await createTicket(org, 'high');
    const medium = await createTicket(org, 'medium');

    expect(medium.slaDueAt).toBeNull();
    const due = new Date(high.slaDueAt!).getTime();
    const expected = before + deps.config.SLA_MINUTES * 60_000;
    expect(Math.abs(due - expected)).toBeLessThan(5_000);

    expect(sla.scheduled).toEqual([
      { job: { ticketId: high.id, organizationId: org.orgId }, dueAt: new Date(high.slaDueAt!) },
    ]);
  });

  it('starts the clock when priority is raised and stops it when lowered', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org, 'low');

    const raised = await org.asAdmin
      .patch(`/api/tickets/${ticket.id}`)
      .send({ priority: 'urgent' })
      .expect(200);
    expect(raised.body.ticket.slaDueAt).not.toBeNull();
    expect(sla.scheduled).toHaveLength(1);

    const lowered = await org.asAdmin
      .patch(`/api/tickets/${ticket.id}`)
      .send({ priority: 'medium' })
      .expect(200);
    expect(lowered.body.ticket.slaDueAt).toBeNull();
  });

  it('records the first Admin/Agent comment as the response', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org, 'high');

    await org.asAgent.post(`/api/tickets/${ticket.id}/comments`).send({ body: 'Looking' });
    const first = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(first.firstResponseAt).not.toBeNull();

    // A later comment doesn't move it.
    await org.asAdmin.post(`/api/tickets/${ticket.id}/comments`).send({ body: 'Update' });
    const second = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(second.firstResponseAt).toEqual(first.firstResponseAt);
  });
});

describe('flagging overdue tickets', () => {
  it('flags an unanswered overdue ticket once and alerts only its organization', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    await setupOrgWithRoles(app, 'Globex');
    const ticket = await createTicket(org, 'urgent');
    await expireDeadline(ticket.id);
    recorder.events.length = 0;

    const job = { ticketId: ticket.id, organizationId: org.orgId };
    expect(await flagIfOverdue(deps, job)).toBe(true);
    // Running it again (e.g. job retry or the sweep) changes nothing.
    expect(await flagIfOverdue(deps, job)).toBe(false);

    const flagged = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(flagged.slaBreachedAt).not.toBeNull();
    expect(breachEvents()).toHaveLength(1);
    expect(breachEvents()[0]!.organizationId).toBe(org.orgId);
  });

  it('does not flag a ticket before its deadline', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const ticket = await createTicket(org, 'high');
    expect(await flagIfOverdue(deps, { ticketId: ticket.id, organizationId: org.orgId })).toBe(
      false,
    );
  });

  it('does not flag tickets that got a staff response, were resolved, or were lowered', async () => {
    const org = await setupOrgWithRoles(app, 'Acme');
    const answered = await createTicket(org, 'high');
    await org.asAgent.post(`/api/tickets/${answered.id}/comments`).send({ body: 'On it' });

    const resolved = await createTicket(org, 'high');
    await org.asAdmin.patch(`/api/tickets/${resolved.id}`).send({ status: 'in_progress' });
    await org.asAdmin.patch(`/api/tickets/${resolved.id}`).send({ status: 'resolved' });

    const lowered = await createTicket(org, 'urgent');
    await expireDeadline(lowered.id);
    await prisma.ticket.update({ where: { id: lowered.id }, data: { priority: 'low' } });

    for (const t of [answered, resolved]) await expireDeadline(t.id);
    for (const t of [answered, resolved, lowered]) {
      expect(await flagIfOverdue(deps, { ticketId: t.id, organizationId: org.orgId })).toBe(false);
    }
  });

  it('ignores a job whose organization does not match the ticket', async () => {
    const acme = await setupOrgWithRoles(app, 'Acme');
    const globex = await setupOrgWithRoles(app, 'Globex');
    const ticket = await createTicket(acme, 'urgent');
    await expireDeadline(ticket.id);

    expect(await flagIfOverdue(deps, { ticketId: ticket.id, organizationId: globex.orgId })).toBe(
      false,
    );
  });
});

describe('safety-net sweep', () => {
  it('flags every overdue ticket across organizations, each alert to its own org', async () => {
    const acme = await setupOrgWithRoles(app, 'Acme');
    const globex = await setupOrgWithRoles(app, 'Globex');
    const a = await createTicket(acme, 'high');
    const g = await createTicket(globex, 'urgent');
    await createTicket(acme, 'high'); // not overdue yet
    await expireDeadline(a.id);
    await expireDeadline(g.id);
    recorder.events.length = 0;

    expect(await sweepOverdue(deps)).toBe(2);
    expect(await sweepOverdue(deps)).toBe(0);

    const byTicket = Object.fromEntries(
      breachEvents().map((e) => [(e.payload as { ticket: { id: string } }).ticket.id, e]),
    );
    expect(byTicket[a.id]!.organizationId).toBe(acme.orgId);
    expect(byTicket[g.id]!.organizationId).toBe(globex.orgId);
  });
});
