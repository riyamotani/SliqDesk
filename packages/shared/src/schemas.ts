import { z } from 'zod';
import { ROLES, TICKET_PRIORITIES, TICKET_STATUSES } from './domain.js';

/**
 * Request validation schemas. The API validates every body and query string
 * with these; the web app reuses them for form validation and types.
 */

const email = z.string().trim().toLowerCase().email().max(254);
// bcrypt only uses the first 72 bytes of a password, so cap it there.
const password = z.string().min(8, 'Password must be at least 8 characters').max(72);
const name = z.string().trim().min(1).max(100);
const id = z.string().uuid();

export const signupSchema = z.object({
  organizationName: z.string().trim().min(1).max(100),
  name,
  email,
  password,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createMemberSchema = z.object({
  name,
  email,
  role: z.enum(ROLES),
  password,
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  role: z.enum(ROLES),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const createTicketSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  priority: z.enum(TICKET_PRIORITIES).default('medium'),
  assigneeId: id.nullable().optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
    status: z.enum(TICKET_STATUSES),
    priority: z.enum(TICKET_PRIORITIES),
    assigneeId: id.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const listTicketsQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  // A member id, or the special values "me" and "unassigned".
  assigneeId: z.union([id, z.literal('me'), z.literal('unassigned')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
