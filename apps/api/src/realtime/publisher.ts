import type { ServerEventName, ServerToClientEvents } from '@sliqdesk/shared';
import type { Emitter } from '@socket.io/redis-emitter';
import { orgRoom, userRoom } from '@sliqdesk/shared';
import type { Server } from 'socket.io';
import type { AuthContext } from '../auth/auth.service.js';

/**
 * How services send real-time events. Every event is addressed to exactly one
 * organization's room, so a client only ever receives its own org's events.
 */
export interface EventPublisher {
  toOrg<E extends ServerEventName>(
    organizationId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
  /** Closes all live connections of a user (after logout or removal). */
  disconnectUser(userId: string): void;
}

/** Socket.IO server typed with our events; each socket carries its AuthContext. */
export type SocketServer = Server<
  Record<string, never>, // client -> server events: none, clients only listen
  ServerToClientEvents,
  Record<string, never>, // events between server instances: none
  { auth: AuthContext }
>;

/**
 * Publishes through the Socket.IO server. With the Redis adapter installed, an
 * emit here reaches clients connected to ANY API instance.
 */
export function createSocketPublisher(io: SocketServer): EventPublisher {
  return {
    toOrg(organizationId, event, ...args) {
      io.to(orgRoom(organizationId)).emit(event, ...args);
    },
    disconnectUser(userId) {
      io.in(userRoom(userId)).disconnectSockets(true);
    },
  };
}

/**
 * Publishes from a process that has no Socket.IO server (the SLA worker). The
 * emitter writes to the same Redis channels the API's Redis adapter listens
 * on, so the API delivers the event to the right sockets.
 */
export function createEmitterPublisher(emitter: Emitter<ServerToClientEvents>): EventPublisher {
  return {
    toOrg(organizationId, event, ...args) {
      emitter.to(orgRoom(organizationId)).emit(event, ...args);
    },
    disconnectUser(userId) {
      emitter.in(userRoom(userId)).disconnectSockets(true);
    },
  };
}

/** For tests: records events instead of sending them. */
export function createRecordingPublisher() {
  const events: { organizationId: string; event: ServerEventName; payload: unknown }[] = [];
  const disconnected: string[] = [];
  const publisher: EventPublisher = {
    toOrg(organizationId, event, ...args) {
      events.push({ organizationId, event, payload: args[0] });
    },
    disconnectUser(userId) {
      disconnected.push(userId);
    },
  };
  return { publisher, events, disconnected };
}
