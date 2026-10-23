import type { Prisma } from '@prisma/client';
import { SLA_PRIORITIES } from '@sliqdesk/shared';
import type { Deps } from '../deps.js';
import { ticketInclude, toTicket } from '../tickets/ticket.mapper.js';
import type { SlaJobData } from './sla.queue.js';

type CheckDeps = Pick<Deps, 'prisma' | 'publisher' | 'logger'>;

/** What "overdue and not yet flagged" means, in one place. */
function overdueWhere(now: Date): Prisma.TicketWhereInput {
  return {
    firstResponseAt: null, // no Admin/Agent comment yet
    slaBreachedAt: null, // not flagged before
    slaDueAt: { lte: now }, // deadline has passed
    priority: { in: [...SLA_PRIORITIES] }, // still high/urgent
    status: { in: ['open', 'in_progress'] }, // still waiting on the team
  };
}

/**
 * Flags one ticket as overdue if it still qualifies, and notifies its
 * organization. Safe to run any number of times: the conditional UPDATE only
 * matches once, so a ticket is flagged (and announced) exactly once, even when
 * the delayed job and the sweep race each other. Returns true if it flagged.
 */
export async function flagIfOverdue(
  deps: CheckDeps,
  job: SlaJobData,
  now = new Date(),
): Promise<boolean> {
  const { count } = await deps.prisma.ticket.updateMany({
    where: { id: job.ticketId, organizationId: job.organizationId, ...overdueWhere(now) },
    data: { slaBreachedAt: now },
  });
  if (count === 0) return false;

  const row = await deps.prisma.ticket.findFirst({
    where: { id: job.ticketId, organizationId: job.organizationId },
    include: ticketInclude,
  });
  if (row) {
    const ticket = toTicket(row);
    deps.publisher.toOrg(job.organizationId, 'ticket.sla_breached', { ticket });
    deps.publisher.toOrg(job.organizationId, 'ticket.updated', { ticket });
  }
  deps.logger.info({ ticketId: job.ticketId }, 'Ticket flagged as SLA overdue');
  return true;
}

/**
 * Safety net, run periodically by the worker: flags every overdue ticket,
 * including ones whose delayed job was never queued (e.g. Redis was down when
 * the ticket was saved). Returns how many tickets it flagged.
 */
export async function sweepOverdue(deps: CheckDeps, now = new Date()): Promise<number> {
  const candidates = await deps.prisma.ticket.findMany({
    where: overdueWhere(now),
    select: { id: true, organizationId: true },
    orderBy: { slaDueAt: 'asc' },
    take: 500,
  });
  let flagged = 0;
  for (const t of candidates) {
    if (await flagIfOverdue(deps, { ticketId: t.id, organizationId: t.organizationId }, now)) {
      flagged++;
    }
  }
  return flagged;
}
