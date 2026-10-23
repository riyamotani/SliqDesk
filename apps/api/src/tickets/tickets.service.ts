import type { Prisma } from '@prisma/client';
import {
  canCreateTicket,
  type CreateTicketInput,
  type ListTicketsQuery,
  type Paginated,
  type Ticket,
  type UpdateTicketInput,
} from '@sliqdesk/shared';
import type { AuthContext } from '../auth/auth.service.js';
import type { Deps } from '../deps.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { ticketInclude, toTicket } from './ticket.mapper.js';
import { planTicketUpdate } from './ticket.rules.js';

type Db = Deps['prisma'] | Prisma.TransactionClient;

/**
 * A ticket of the caller's organization, or 404. Every ticket lookup goes
 * through here, so a ticket id from another organization is never found.
 */
export async function findTicketOrThrow(db: Db, organizationId: string, ticketId: string) {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, organizationId },
    include: ticketInclude,
  });
  if (!ticket) throw notFound('Ticket');
  return ticket;
}

/**
 * Tickets can only be assigned to active Admins/Agents of the same
 * organization. Viewers and users of other organizations get the same answer,
 * so the error doesn't reveal whether an id exists elsewhere.
 */
async function assertAssignable(db: Db, organizationId: string, assigneeId: string) {
  const assignee = await db.user.findFirst({
    where: {
      id: assigneeId,
      organizationId,
      removedAt: null,
      role: { in: ['admin', 'agent'] },
    },
    select: { id: true },
  });
  if (!assignee) {
    throw unprocessable(
      'INVALID_ASSIGNEE',
      'Tickets can only be assigned to Admins and Agents of your organization',
    );
  }
}

export async function listTickets(
  deps: Deps,
  auth: AuthContext,
  query: ListTicketsQuery,
): Promise<Paginated<Ticket>> {
  const where: Prisma.TicketWhereInput = { organizationId: auth.organizationId };
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.assigneeId === 'me') where.assigneeId = auth.id;
  else if (query.assigneeId === 'unassigned') where.assigneeId = null;
  else if (query.assigneeId) where.assigneeId = query.assigneeId;

  // Both queries in one transaction so the page and the total agree.
  const [rows, total] = await deps.prisma.$transaction([
    deps.prisma.ticket.findMany({
      where,
      include: ticketInclude,
      // id as a tie-breaker keeps the order stable when timestamps are equal.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    deps.prisma.ticket.count({ where }),
  ]);

  return { data: rows.map(toTicket), page: query.page, pageSize: query.pageSize, total };
}

export async function getTicket(deps: Deps, auth: AuthContext, ticketId: string): Promise<Ticket> {
  return toTicket(await findTicketOrThrow(deps.prisma, auth.organizationId, ticketId));
}

export async function createTicket(
  deps: Deps,
  auth: AuthContext,
  input: CreateTicketInput,
): Promise<Ticket> {
  if (!canCreateTicket(auth)) throw forbidden('Viewers cannot create tickets');
  if (input.assigneeId) await assertAssignable(deps.prisma, auth.organizationId, input.assigneeId);

  const row = await deps.prisma.ticket.create({
    data: {
      // Tenant and author always come from the session, never from the body.
      organizationId: auth.organizationId,
      createdById: auth.id,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
    },
    include: ticketInclude,
  });
  const ticket = toTicket(row);
  // Events are emitted only after the database write succeeded.
  deps.publisher.toOrg(auth.organizationId, 'ticket.created', { ticket });
  return ticket;
}

export async function updateTicket(
  deps: Deps,
  auth: AuthContext,
  ticketId: string,
  input: UpdateTicketInput,
): Promise<Ticket> {
  const current = await findTicketOrThrow(deps.prisma, auth.organizationId, ticketId);
  const changes = planTicketUpdate(auth, current, input);
  if (Object.keys(changes).length === 0) return toTicket(current);

  if (changes.assigneeId) {
    await assertAssignable(deps.prisma, auth.organizationId, changes.assigneeId);
  }

  // Optimistic concurrency: only write if nobody changed the ticket since we
  // read it. Otherwise our permission check may be stale (e.g. someone else
  // claimed the ticket a moment ago), so we refuse instead of overwriting.
  const { count } = await deps.prisma.ticket.updateMany({
    where: { id: current.id, organizationId: auth.organizationId, updatedAt: current.updatedAt },
    data: changes,
  });
  if (count === 0) {
    throw conflict('TICKET_CHANGED', 'This ticket was just changed by someone else. Reload it.');
  }

  const ticket = toTicket(await findTicketOrThrow(deps.prisma, auth.organizationId, ticketId));
  deps.publisher.toOrg(auth.organizationId, 'ticket.updated', { ticket });
  return ticket;
}
