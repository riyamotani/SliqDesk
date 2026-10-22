import { describe, expect, it } from 'vitest';
import {
  canComment,
  canCreateTicket,
  canManageMembers,
  canTransition,
  canUpdateTicket,
  TICKET_STATUSES,
  type Actor,
} from './domain.js';

const admin: Actor = { id: 'a', role: 'admin' };
const agent: Actor = { id: 'b', role: 'agent' };
const viewer: Actor = { id: 'c', role: 'viewer' };

describe('status transitions', () => {
  it('allows the normal workflow', () => {
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
  });

  it('allows reopening a resolved ticket', () => {
    expect(canTransition('resolved', 'open')).toBe(true);
  });

  it('never allows leaving closed', () => {
    for (const to of TICKET_STATUSES) expect(canTransition('closed', to)).toBe(false);
  });

  it('rejects "transitioning" to the same status', () => {
    for (const s of TICKET_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

describe('permissions', () => {
  it('lets admins and agents create tickets and comment, but not viewers', () => {
    expect(canCreateTicket(admin)).toBe(true);
    expect(canCreateTicket(agent)).toBe(true);
    expect(canCreateTicket(viewer)).toBe(false);
    expect(canComment(admin)).toBe(true);
    expect(canComment(agent)).toBe(true);
    expect(canComment(viewer)).toBe(false);
  });

  it('only lets admins manage members', () => {
    expect(canManageMembers(admin)).toBe(true);
    expect(canManageMembers(agent)).toBe(false);
    expect(canManageMembers(viewer)).toBe(false);
  });

  it('lets admins update any open ticket', () => {
    expect(canUpdateTicket(admin, { assigneeId: 'someone-else', status: 'open' })).toBe(true);
  });

  it('lets agents update only unassigned tickets or their own', () => {
    expect(canUpdateTicket(agent, { assigneeId: null, status: 'open' })).toBe(true);
    expect(canUpdateTicket(agent, { assigneeId: agent.id, status: 'in_progress' })).toBe(true);
    expect(canUpdateTicket(agent, { assigneeId: 'someone-else', status: 'open' })).toBe(false);
  });

  it('never lets viewers update tickets', () => {
    expect(canUpdateTicket(viewer, { assigneeId: null, status: 'open' })).toBe(false);
    expect(canUpdateTicket(viewer, { assigneeId: viewer.id, status: 'open' })).toBe(false);
  });

  it('blocks everyone, including admins, from updating closed tickets', () => {
    expect(canUpdateTicket(admin, { assigneeId: null, status: 'closed' })).toBe(false);
    expect(canUpdateTicket(agent, { assigneeId: agent.id, status: 'closed' })).toBe(false);
  });
});
