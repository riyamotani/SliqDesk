import { canComment, isStaffRole, type Comment, type CreateCommentInput } from '@sliqdesk/shared';
import type { AuthContext } from '../auth/auth.service.js';
import type { Deps } from '../deps.js';
import { conflict, forbidden } from '../lib/errors.js';
import { commentInclude, ticketInclude, toComment, toTicket } from './ticket.mapper.js';
import { findTicketOrThrow } from './tickets.service.js';

export async function listComments(
  deps: Deps,
  auth: AuthContext,
  ticketId: string,
): Promise<Comment[]> {
  // 404 unless the ticket belongs to the caller's organization.
  await findTicketOrThrow(deps.prisma, auth.organizationId, ticketId);
  const rows = await deps.prisma.comment.findMany({
    where: { ticketId, organizationId: auth.organizationId },
    include: commentInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toComment);
}

export async function addComment(
  deps: Deps,
  auth: AuthContext,
  ticketId: string,
  input: CreateCommentInput,
): Promise<Comment> {
  if (!canComment(auth)) throw forbidden('Viewers cannot comment');
  const ticket = await findTicketOrThrow(deps.prisma, auth.organizationId, ticketId);
  if (ticket.status === 'closed') {
    throw conflict('TICKET_CLOSED', 'Closed tickets cannot be changed');
  }

  const { row, firstResponse } = await deps.prisma.$transaction(async (tx) => {
    const row = await tx.comment.create({
      data: {
        organizationId: auth.organizationId,
        ticketId: ticket.id,
        authorId: auth.id,
        body: input.body,
      },
      include: commentInclude,
    });
    // The first Admin/Agent comment satisfies the SLA. The condition makes it
    // race-safe: only one comment can ever set firstResponseAt.
    const { count } = isStaffRole(auth.role)
      ? await tx.ticket.updateMany({
          where: { id: ticket.id, organizationId: auth.organizationId, firstResponseAt: null },
          data: { firstResponseAt: row.createdAt },
        })
      : { count: 0 };
    return { row, firstResponse: count === 1 };
  });

  const comment = toComment(row);
  deps.publisher.toOrg(auth.organizationId, 'comment.created', { comment });
  if (firstResponse) {
    const updated = await deps.prisma.ticket.findFirst({
      where: { id: ticket.id, organizationId: auth.organizationId },
      include: ticketInclude,
    });
    if (updated) {
      deps.publisher.toOrg(auth.organizationId, 'ticket.updated', { ticket: toTicket(updated) });
    }
  }
  return comment;
}
