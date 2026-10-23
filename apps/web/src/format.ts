import type { Ticket, TicketPriority, TicketStatus } from '@sliqdesk/shared';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/** Timestamps arrive in UTC (ISO strings) and are shown in the viewer's time zone. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export type SlaState =
  { kind: 'none' } | { kind: 'breached' } | { kind: 'met' } | { kind: 'due'; at: string };

export function slaState(ticket: Ticket): SlaState {
  if (ticket.slaBreachedAt) return { kind: 'breached' };
  if (!ticket.slaDueAt) return { kind: 'none' };
  if (ticket.firstResponseAt) return { kind: 'met' };
  return { kind: 'due', at: ticket.slaDueAt };
}
