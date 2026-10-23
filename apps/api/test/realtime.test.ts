import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerToClientEvents } from '@sliqdesk/shared';
import { io as connect, type Socket } from 'socket.io-client';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPrisma } from '../src/db.js';
import type { Deps } from '../src/deps.js';
import { createLogger } from '../src/lib/logger.js';
import { createSocketPublisher, type SocketServer } from '../src/realtime/publisher.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { createRecordingScheduler } from '../src/sla/sla.queue.js';
import { resetDatabase } from './helpers.js';

/**
 * End-to-end real-time tests: a real HTTP + Socket.IO server on a random port,
 * real socket.io clients authenticating with real session cookies.
 */
const config = loadConfig();
const prisma = createPrisma(config);
const logger = createLogger('silent', 'test');
let httpServer: Server;
let io: SocketServer;
let baseUrl: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  httpServer = createServer();
  io = createSocketServer(httpServer, { config, prisma, logger });
  const deps: Deps = {
    config,
    prisma,
    logger,
    publisher: createSocketPublisher(io),
    slaScheduler: createRecordingScheduler().scheduler,
  };
  httpServer.on('request', createApp(deps));
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

beforeEach(() => resetDatabase(prisma));

afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

afterAll(async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await prisma.$disconnect();
});

/** Signs up an org and returns its session cookie. */
async function signup(prefix: string): Promise<string> {
  const res = await supertest(baseUrl)
    .post('/api/auth/signup')
    .send({
      organizationName: prefix,
      name: `${prefix} Admin`,
      email: `admin@${prefix.toLowerCase()}.test`,
      password: 'password123',
    })
    .expect(201);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  return cookie;
}

function openSocket(cookie?: string): Socket<ServerToClientEvents> {
  const socket: Socket<ServerToClientEvents> = connect(baseUrl, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
}

function nextEvent<E extends keyof ServerToClientEvents>(
  socket: Socket<ServerToClientEvents>,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    // Typed loosely here: Socket.IO's generic listener types are hard to narrow.
    (socket as Socket).once(event as string, (payload: unknown) => resolve(payload as never));
  });
}

const tick = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

describe('real-time updates', () => {
  it('rejects connections without a valid session', async () => {
    const anonymous = openSocket();
    await expect(connected(anonymous)).rejects.toThrow('UNAUTHORIZED');

    const forged = openSocket('sliqdesk_session=not-a-real-token');
    await expect(connected(forged)).rejects.toThrow('UNAUTHORIZED');
  });

  it("delivers events to the actor's organization only", async () => {
    const acmeCookie = await signup('Acme');
    const globexCookie = await signup('Globex');
    const acmeSocket = openSocket(acmeCookie);
    const globexSocket = openSocket(globexCookie);
    await Promise.all([connected(acmeSocket), connected(globexSocket)]);

    const leaked: unknown[] = [];
    globexSocket.onAny((event, payload) => leaked.push({ event, payload }));

    const received = nextEvent(acmeSocket, 'ticket.created');
    await supertest(baseUrl)
      .post('/api/tickets')
      .set('Cookie', acmeCookie)
      .send({ title: 'Acme secret' })
      .expect(201);

    const { ticket } = await received;
    expect(ticket.title).toBe('Acme secret');
    await tick();
    expect(leaked).toEqual([]);
  });

  it('pushes comment and ticket updates to other members', async () => {
    const cookie = await signup('Acme');
    const socket = openSocket(cookie);
    await connected(socket);

    const created = await supertest(baseUrl)
      .post('/api/tickets')
      .set('Cookie', cookie)
      .send({ title: 'T' })
      .expect(201);
    const id = created.body.ticket.id as string;

    const comment = nextEvent(socket, 'comment.created');
    await supertest(baseUrl)
      .post(`/api/tickets/${id}/comments`)
      .set('Cookie', cookie)
      .send({ body: 'On it' });
    expect((await comment).comment).toMatchObject({ ticketId: id, body: 'On it' });

    const updated = nextEvent(socket, 'ticket.updated');
    await supertest(baseUrl)
      .patch(`/api/tickets/${id}`)
      .set('Cookie', cookie)
      .send({ status: 'in_progress' });
    expect((await updated).ticket.status).toBe('in_progress');
  });

  it("closes a user's live sockets when they log out", async () => {
    const cookie = await signup('Acme');
    const socket = openSocket(cookie);
    await connected(socket);

    const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
    await supertest(baseUrl).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await disconnected;
    expect(socket.connected).toBe(false);
  });
});
