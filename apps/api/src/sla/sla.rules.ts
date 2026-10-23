import { isSlaPriority, type TicketPriority } from '@sliqdesk/shared';

/** The ticket fields the SLA rules look at. */
export interface SlaState {
  priority: TicketPriority;
  slaDueAt: Date | null;
  firstResponseAt: Date | null;
  slaBreachedAt: Date | null;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Deadline for a new ticket: only high/urgent tickets get one. */
export function initialSlaDueAt(priority: TicketPriority, now: Date, slaMinutes: number) {
  return isSlaPriority(priority) ? addMinutes(now, slaMinutes) : null;
}

/**
 * How a priority change affects the deadline. Returns the new slaDueAt, or
 * `undefined` when nothing changes. Pure, so it's unit tested.
 *
 * - Once a staff member has responded, or the SLA was already breached, the
 *   SLA is settled and priority changes no longer matter.
 * - Raised to high/urgent without a deadline: the clock starts now.
 * - Lowered below high: the deadline is cleared.
 */
export function slaDueAtAfterPriorityChange(
  ticket: SlaState,
  newPriority: TicketPriority,
  now: Date,
  slaMinutes: number,
): Date | null | undefined {
  if (ticket.firstResponseAt || ticket.slaBreachedAt) return undefined;
  if (isSlaPriority(newPriority)) {
    return ticket.slaDueAt ? undefined : addMinutes(now, slaMinutes);
  }
  return ticket.slaDueAt ? null : undefined;
}
