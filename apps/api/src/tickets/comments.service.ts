import { canComment, type Comment, type CreateCommentInput } from '@sliqdesk/shared';
import type { AuthContext } from '../auth/auth.service.js';
import type { Deps } from '../deps.js';
import { conflict, forbidden } from '../lib/errors.js';
import { commentInclude, toComment } from './ticket.mapper.js';
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

  const row = await deps.prisma.comment.create({
    data: {
      organizationId: auth.organizationId,
      ticketId: ticket.id,
      authorId: auth.id,
      body: input.body,
    },
    include: commentInclude,
  });
  const comment = toComment(row);
  deps.publisher.toOrg(auth.organizationId, 'comment.created', { comment });
  return comment;
}
