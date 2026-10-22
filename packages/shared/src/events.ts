import type { Comment, Ticket } from './dto.js';

/**
 * Real-time events pushed from the server to clients over Socket.IO.
 * Every event is emitted only to the room of the organization it belongs to.
 */
export interface ServerToClientEvents {
  'ticket.created': (payload: { ticket: Ticket }) => void;
  'ticket.updated': (payload: { ticket: Ticket }) => void;
  'ticket.sla_breached': (payload: { ticket: Ticket }) => void;
  'comment.created': (payload: { comment: Comment }) => void;
  'members.changed': () => void;
}

export type ServerEventName = keyof ServerToClientEvents;

export const orgRoom = (organizationId: string) => `org:${organizationId}`;
export const userRoom = (userId: string) => `user:${userId}`;
