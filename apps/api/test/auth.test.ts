import supertest from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, resetDatabase, signupOrg } from './helpers.js';

const { app, prisma, request } = createTestContext();

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

function sessionCookie(res: supertest.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const cookie = cookies.find((c) => c.startsWith('sliqdesk_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0]!;
}

describe('signup', () => {
  it('creates an organization with the user as Admin and starts a session', async () => {
    const { agent, user } = await signupOrg(app, 'Acme');
    expect(user).toMatchObject({ role: 'admin', organization: { name: 'Acme Inc' } });

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.id).toBe(user.id);
  });

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const res = await request.post('/api/auth/signup').send({
      organizationName: 'Acme',
      name: 'A',
      email: 'a@acme.test',
      password: 'password123',
    });
    const raw = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    await signupOrg(app, 'Acme');
    const res = await request
      .post('/api/auth/signup')
      .send({
        organizationName: 'Other',
        name: 'B',
        email: 'ADMIN@acme.test',
        password: 'password123',
      })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input and never echoes the password back', async () => {
    const res = await request
      .post('/api/auth/signup')
      .send({ organizationName: '', name: 'B', email: 'not-an-email', password: 'short' })
      .expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body)).not.toContain('short');
  });
});

describe('login', () => {
  it('logs in with the right password', async () => {
    await signupOrg(app, 'Acme');
    const res = await request
      .post('/api/auth/login')
      .send({ email: 'admin@acme.test', password: 'password123' })
      .expect(200);
    expect(res.body.user.email).toBe('admin@acme.test');
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    await signupOrg(app, 'Acme');
    const wrong = await request
      .post('/api/auth/login')
      .send({ email: 'admin@acme.test', password: 'wrong-password' })
      .expect(401);
    const unknown = await request
      .post('/api/auth/login')
      .send({ email: 'nobody@acme.test', password: 'wrong-password' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe('sessions', () => {
  it('rejects requests without a session', async () => {
    await request.get('/api/auth/me').expect(401);
  });

  it('logout revokes the token server-side, not just the cookie', async () => {
    await signupOrg(app, 'Acme');
    const login = await request
      .post('/api/auth/login')
      .send({ email: 'admin@acme.test', password: 'password123' });
    const cookie = sessionCookie(login);

    await request.get('/api/auth/me').set('Cookie', cookie).expect(200);
    await request.post('/api/auth/logout').set('Cookie', cookie).expect(204);
    // Replaying the old cookie (e.g. a copy an attacker kept) no longer works.
    await request.get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('rejects the session of a removed member immediately', async () => {
    const { agent, user } = await signupOrg(app, 'Acme');
    await prisma.user.update({ where: { id: user.id }, data: { removedAt: new Date() } });
    await agent.get('/api/auth/me').expect(401);
  });
});
