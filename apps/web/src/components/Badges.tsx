import type { Ticket, TicketPriority, TicketStatus } from '@sliqdesk/shared';
import { formatDateTime, PRIORITY_LABELS, slaState, STATUS_LABELS } from '../format';

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function SlaBadge({ ticket }: { ticket: Ticket }) {
  const sla = slaState(ticket);
  if (sla.kind === 'breached') return <span className="badge sla-breached">SLA overdue</span>;
  if (sla.kind === 'due') {
    return (
      <span className="badge sla-due" title="Needs a reply from an Admin or Agent by then">
        Reply by {formatDateTime(sla.at)}
      </span>
    );
  }
  if (sla.kind === 'met') return <span className="badge sla-met">SLA met</span>;
  return null;
}
