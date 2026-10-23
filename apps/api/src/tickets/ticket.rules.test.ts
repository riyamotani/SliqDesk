import type { Actor } from '@sliqdesk/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/errors.js';
import { planTicketUpdate, type TicketState } from './ticket.rules.js';

const admin: Actor = { id: 'admin-1', role: 'admin' };
const agent: Actor = { id: 'agent-1', role: 'agent' };
const viewer: Actor = { id: 'viewer-1', role: 'viewer' };

const ticket: TicketState = {
  title: 'Printer on fire',
  description: '',
  status: 'open',
  priority: 'high',
  assigneeId: null,
};

function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
  }
  throw new Error('expected an AppError');
}

describe('planTicketUpdate', () => {
  it('returns only the fields that actually change', () => {
    const changes = planTicketUpdate(admin, ticket, {
      title: 'Printer on fire',
      status: 'in_progress',
      priority: 'high',
    });
    expect(changes).toEqual({ status: 'in_progress' });
  });

  it('treats resending the current status as a no-op, not an invalid transition', () => {
    expect(planTicketUpdate(admin, ticket, { status: 'open' })).toEqual({});
  });

  it('rejects transitions that are not allowed with 422', () => {
    const err = errorOf(() => planTicketUpdate(admin, ticket, { status: 'resolved' }));
    expect(err.status).toBe(422);
    expect(err.code).toBe('INVALID_TRANSITION');
  });

  it('checks the transition before applying any other change', () => {
    // A valid priority change in the same request doesn't sneak through.
    expect(() => planTicketUpdate(admin, ticket, { priority: 'low', status: 'resolved' })).toThrow(
      AppError,
    );
  });

  it('blocks every change to a closed ticket with 409, even for admins', () => {
    const closed = { ...ticket, status: 'closed' as const };
    const err = errorOf(() => planTicketUpdate(admin, closed, { status: 'open' }));
    expect(err.status).toBe(409);
    expect(err.code).toBe('TICKET_CLOSED');
  });

  it('lets an agent update unassigned tickets and their own', () => {
    expect(planTicketUpdate(agent, ticket, { assigneeId: agent.id })).toEqual({
      assigneeId: agent.id,
    });
    const own = { ...ticket, assigneeId: agent.id };
    expect(planTicketUpdate(agent, own, { priority: 'urgent' })).toEqual({ priority: 'urgent' });
  });

  it("forbids an agent from updating someone else's ticket", () => {
    const others = { ...ticket, assigneeId: 'agent-2' };
    expect(errorOf(() => planTicketUpdate(agent, others, { priority: 'low' })).status).toBe(403);
  });

  it('forbids viewers from updating anything', () => {
    expect(errorOf(() => planTicketUpdate(viewer, ticket, { priority: 'low' })).status).toBe(403);
  });
});
