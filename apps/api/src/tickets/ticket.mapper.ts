import type { Prisma } from '@prisma/client';
import type { Comment, Ticket } from '@sliqdesk/shared';

const userSummary = { select: { id: true, name: true } } as const;

/** Relations loaded with every ticket so the API can return names, not just ids. */
export const ticketInclude = { createdBy: userSummary, assignee: userSummary } as const;
export type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export const commentInclude = { author: userSummary } as const;
export type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdBy: row.createdBy,
    assignee: row.assignee,
    slaDueAt: iso(row.slaDueAt),
    slaBreachedAt: iso(row.slaBreachedAt),
    firstResponseAt: iso(row.firstResponseAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    ticketId: row.ticketId,
    body: row.body,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}
