/**
 * Core business rules shared by the API (which enforces them) and the web app
 * (which uses them only to decide which controls to show). The server never
 * trusts the client: every rule here is re-checked on the API.
 */

export const ROLES = ['admin', 'agent', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Priorities that start an SLA timer when a ticket has them. */
export const SLA_PRIORITIES: readonly TicketPriority[] = ['high', 'urgent'];

/**
 * Allowed status transitions:
 * - Only a ticket someone is working on can be resolved (no open -> resolved).
 * - Open tickets can be closed directly (spam, duplicates).
 * - Resolved tickets can be reopened, which puts them back in progress.
 * - `closed` is terminal: a closed ticket cannot be changed at all.
 */
export const STATUS_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['open', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function isSlaPriority(priority: TicketPriority): boolean {
  return SLA_PRIORITIES.includes(priority);
}

/** Roles whose comments count as a response for the SLA, and who can be assigned tickets. */
export function isStaffRole(role: Role): boolean {
  return role === 'admin' || role === 'agent';
}

export interface Actor {
  id: string;
  role: Role;
}

export function canCreateTicket(actor: Actor): boolean {
  return isStaffRole(actor.role);
}

export function canComment(actor: Actor): boolean {
  return isStaffRole(actor.role);
}

export function canManageMembers(actor: Actor): boolean {
  return actor.role === 'admin';
}

/**
 * Admins can update any ticket. Agents can update tickets assigned to them or
 * unassigned ones. Viewers can't update tickets. Closed tickets can't be
 * updated by anyone.
 */
export function canUpdateTicket(
  actor: Actor,
  ticket: { assigneeId: string | null; status: TicketStatus },
): boolean {
  if (ticket.status === 'closed') return false;
  if (actor.role === 'admin') return true;
  if (actor.role === 'agent') return ticket.assigneeId === null || ticket.assigneeId === actor.id;
  return false;
}
