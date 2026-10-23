import {
  canTransition,
  canUpdateTicket,
  type Actor,
  type TicketPriority,
  type TicketStatus,
  type UpdateTicketInput,
} from '@sliqdesk/shared';
import { conflict, forbidden, unprocessable } from '../lib/errors.js';

/** The parts of a ticket the update rules look at. */
export interface TicketState {
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
}

/**
 * Decides what an update actually changes, or throws if it isn't allowed.
 * Pure (no database), so every rule is covered by fast unit tests.
 *
 * Fields equal to their current value are dropped, so a client can resend the
 * whole form without tripping the "same status" transition rule.
 */
export function planTicketUpdate(
  actor: Actor,
  ticket: TicketState,
  input: UpdateTicketInput,
): Partial<TicketState> {
  if (ticket.status === 'closed') {
    throw conflict('TICKET_CLOSED', 'Closed tickets cannot be changed');
  }
  if (!canUpdateTicket(actor, ticket)) {
    throw forbidden('You can only update tickets assigned to you or unassigned tickets');
  }

  const changes: Partial<TicketState> = {};
  if (input.title !== undefined && input.title !== ticket.title) changes.title = input.title;
  if (input.description !== undefined && input.description !== ticket.description) {
    changes.description = input.description;
  }
  if (input.priority !== undefined && input.priority !== ticket.priority) {
    changes.priority = input.priority;
  }
  if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
    changes.assigneeId = input.assigneeId;
  }
  if (input.status !== undefined && input.status !== ticket.status) {
    if (!canTransition(ticket.status, input.status)) {
      throw unprocessable(
        'INVALID_TRANSITION',
        `A ticket cannot move from ${ticket.status} to ${input.status}`,
      );
    }
    changes.status = input.status;
  }
  return changes;
}
