import type { Role, TicketPriority, TicketStatus } from './domain.js';

/** Shapes returned by the API. Dates are ISO strings on the wire. */

export interface UserSummary {
  id: string;
  name: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  organization: { id: string; name: string };
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdBy: UserSummary;
  assignee: UserSummary | null;
  slaDueAt: string | null;
  slaBreachedAt: string | null;
  firstResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  ticketId: string;
  body: string;
  author: UserSummary;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
