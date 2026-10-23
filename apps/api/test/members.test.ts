import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, loginAs, resetDatabase, signupOrg } from './helpers.js';

const { app, prisma, recorder } = createTestContext();

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

const PASSWORD = 'password123';

/** Org "Acme" with an admin, plus an agent and a viewer added by that admin. */
async function setupAcme() {
  const { agent: admin, user } = await signupOrg(app, 'Acme');
  const agentRes = await admin
    .post('/api/members')
    .send({ name: 'Agent', email: 'agent@acme.test', role: 'agent', password: PASSWORD })
    .expect(201);
  const viewerRes = await admin
    .post('/api/members')
    .send({ name: 'Viewer', email: 'viewer@acme.test', role: 'viewer', password: PASSWORD })
    .expect(201);
  return {
    admin,
    adminId: user.id,
    orgId: user.organization.id,
    agentId: agentRes.body.member.id as string,
    viewerId: viewerRes.body.member.id as string,
  };
}

describe('adding members', () => {
  it('lets an Admin add a member who can then log in with that role', async () => {
    await setupAcme();
    const agent = await loginAs(app, 'agent@acme.test', PASSWORD);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ role: 'agent', organization: { name: 'Acme Inc' } });
  });

  it('rejects an email that already has an account', async () => {
    const { admin } = await setupAcme();
    const res = await admin
      .post('/api/members')
      .send({ name: 'Dup', email: 'agent@acme.test', role: 'viewer', password: PASSWORD })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('never returns password hashes', async () => {
    const { admin } = await setupAcme();
    const res = await admin.get('/api/members').expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('role permissions', () => {
  it('lets every role list members of their own organization', async () => {
    await setupAcme();
    const viewer = await loginAs(app, 'viewer@acme.test', PASSWORD);
    const res = await viewer.get('/api/members').expect(200);
    expect(res.body.data).toHaveLength(3);
  });

  it('forbids Agents and Viewers from managing members', async () => {
    const { adminId } = await setupAcme();
    for (const email of ['agent@acme.test', 'viewer@acme.test']) {
      const user = await loginAs(app, email, PASSWORD);
      await user
        .post('/api/members')
        .send({ name: 'X', email: 'x@acme.test', role: 'admin', password: PASSWORD })
        .expect(403);
      await user.patch(`/api/members/${adminId}`).send({ role: 'viewer' }).expect(403);
      await user.delete(`/api/members/${adminId}`).expect(403);
    }
  });
});

describe('tenant isolation', () => {
  it("only lists the caller's own organization", async () => {
    await setupAcme();
    const { agent: globex } = await signupOrg(app, 'Globex');
    const res = await globex.get('/api/members').expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe('admin@globex.test');
  });

  it("returns 404 when an Admin targets another organization's member", async () => {
    const { agentId } = await setupAcme();
    const { agent: globex } = await signupOrg(app, 'Globex');

    await globex.patch(`/api/members/${agentId}`).send({ role: 'admin' }).expect(404);
    await globex.delete(`/api/members/${agentId}`).expect(404);

    const agent = await prisma.user.findUniqueOrThrow({ where: { id: agentId } });
    expect(agent).toMatchObject({ role: 'agent', removedAt: null });
  });
});

describe('changing roles', () => {
  it('changes a role, which applies on the very next request', async () => {
    const { admin, agentId } = await setupAcme();
    const agent = await loginAs(app, 'agent@acme.test', PASSWORD);

    await admin.patch(`/api/members/${agentId}`).send({ role: 'viewer' }).expect(200);

    // Same cookie as before; the role is read from the database, not the token.
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.role).toBe('viewer');
  });

  it('never leaves an organization without an Admin', async () => {
    const { admin, adminId } = await setupAcme();
    const res = await admin.patch(`/api/members/${adminId}`).send({ role: 'agent' }).expect(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('unassigns open tickets when a member becomes a Viewer', async () => {
    const { admin, orgId, adminId, agentId } = await setupAcme();
    const base = { organizationId: orgId, createdById: adminId, description: '' };
    const open = await prisma.ticket.create({
      data: { ...base, title: 'Open', assigneeId: agentId },
    });
    const closed = await prisma.ticket.create({
      data: { ...base, title: 'Closed', status: 'closed', assigneeId: agentId },
    });

    await admin.patch(`/api/members/${agentId}`).send({ role: 'viewer' }).expect(200);

    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBe(
      null,
    );
    // Closed tickets are frozen, so they keep their assignee.
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: closed.id } })).assigneeId).toBe(
      agentId,
    );
  });
});

describe('removing members', () => {
  it('ends the removed member’s session immediately and blocks login', async () => {
    const { admin, agentId } = await setupAcme();
    const agent = await loginAs(app, 'agent@acme.test', PASSWORD);

    await admin.delete(`/api/members/${agentId}`).expect(204);

    await agent.get('/api/auth/me').expect(401);
    await agent
      .post('/api/auth/login')
      .send({ email: 'agent@acme.test', password: PASSWORD })
      .expect(401);
    const list = await admin.get('/api/members').expect(200);
    expect(list.body.data.map((m: { id: string }) => m.id)).not.toContain(agentId);
  });

  it('keeps the removed member on old tickets but unassigns open ones', async () => {
    const { admin, orgId, agentId } = await setupAcme();
    const ticket = await prisma.ticket.create({
      data: {
        organizationId: orgId,
        createdById: agentId,
        assigneeId: agentId,
        title: 'T',
        description: '',
      },
    });

    await admin.delete(`/api/members/${agentId}`).expect(204);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after).toMatchObject({ createdById: agentId, assigneeId: null });
  });

  it('does not let an Admin remove themselves', async () => {
    const { admin, adminId } = await setupAcme();
    const res = await admin.delete(`/api/members/${adminId}`).expect(409);
    expect(res.body.error.code).toBe('CANNOT_REMOVE_SELF');
  });

  it('reactivates a removed member when their email is added again', async () => {
    const { admin, agentId } = await setupAcme();
    await admin.delete(`/api/members/${agentId}`).expect(204);

    const res = await admin
      .post('/api/members')
      .send({
        name: 'Agent Again',
        email: 'agent@acme.test',
        role: 'viewer',
        password: 'newpass123',
      })
      .expect(201);
    expect(res.body.member).toMatchObject({ id: agentId, role: 'viewer', name: 'Agent Again' });
    await loginAs(app, 'agent@acme.test', 'newpass123');
  });

  it('rejects ids that are not UUIDs with 400', async () => {
    const { admin } = await setupAcme();
    await admin.delete('/api/members/not-a-uuid').expect(400);
  });

  it("disconnects the removed member's sockets and notifies only their organization", async () => {
    const { admin, agentId, orgId } = await setupAcme();
    recorder.events.length = 0;

    await admin.delete(`/api/members/${agentId}`).expect(204);

    expect(recorder.disconnected).toContain(agentId);
    expect(recorder.events).toEqual([
      { organizationId: orgId, event: 'members.changed', payload: undefined },
    ]);
  });
});
