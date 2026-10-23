import type { Prisma, User } from '@prisma/client';
import {
  canManageMembers,
  type CreateMemberInput,
  type Member,
  type UpdateMemberInput,
} from '@sliqdesk/shared';
import type { AuthContext } from '../auth/auth.service.js';
import { isUniqueViolation } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import type { Deps } from '../deps.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';

export function toMember(user: User): Member {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

function requireAdmin(auth: AuthContext) {
  if (!canManageMembers(auth)) throw forbidden('Only Admins can manage members');
}

/**
 * Locks the organization row until the transaction ends, so concurrent member
 * changes in the same organization run one after another. Without it, two
 * admins demoting each other at the same time could both pass the
 * "another admin exists" check and leave the organization with no admin.
 */
async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
}

/** An active member of the caller's organization, or 404 (also for other orgs' users). */
async function findActiveMember(tx: Prisma.TransactionClient, organizationId: string, id: string) {
  const user = await tx.user.findFirst({ where: { id, organizationId, removedAt: null } });
  if (!user) throw notFound('Member');
  return user;
}

async function assertNotLastAdmin(tx: Prisma.TransactionClient, organizationId: string) {
  const admins = await tx.user.count({
    where: { organizationId, role: 'admin', removedAt: null },
  });
  if (admins <= 1) {
    throw conflict('LAST_ADMIN', 'An organization must keep at least one Admin');
  }
}

/** Viewers can't work tickets, so a member who becomes one (or leaves) is unassigned. */
async function unassignOpenTickets(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
) {
  await tx.ticket.updateMany({
    // Closed tickets are frozen and keep their history.
    where: { organizationId, assigneeId: userId, status: { not: 'closed' } },
    data: { assigneeId: null },
  });
}

export async function listMembers(deps: Deps, auth: AuthContext): Promise<Member[]> {
  const users = await deps.prisma.user.findMany({
    where: { organizationId: auth.organizationId, removedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return users.map(toMember);
}

export async function addMember(
  deps: Deps,
  auth: AuthContext,
  input: CreateMemberInput,
): Promise<Member> {
  requireAdmin(auth);
  const member = await createOrReactivateMember(deps, auth, input);
  deps.publisher.toOrg(auth.organizationId, 'members.changed');
  return member;
}

async function createOrReactivateMember(
  deps: Deps,
  auth: AuthContext,
  input: CreateMemberInput,
): Promise<Member> {
  const passwordHash = await hashPassword(input.password);

  const existing = await deps.prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    // A previously removed member of this organization is reactivated.
    if (existing.organizationId === auth.organizationId && existing.removedAt) {
      const user = await deps.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          role: input.role,
          passwordHash,
          removedAt: null,
          tokenVersion: { increment: 1 },
        },
      });
      return toMember(user);
    }
    throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }

  try {
    const user = await deps.prisma.user.create({
      data: {
        organizationId: auth.organizationId,
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
      },
    });
    return toMember(user);
  } catch (err) {
    // Someone created the same email between our check and this insert.
    if (isUniqueViolation(err)) {
      throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function updateMemberRole(
  deps: Deps,
  auth: AuthContext,
  memberId: string,
  input: UpdateMemberInput,
): Promise<Member> {
  requireAdmin(auth);

  const result = await deps.prisma.$transaction(async (tx) => {
    await lockOrganization(tx, auth.organizationId);
    const member = await findActiveMember(tx, auth.organizationId, memberId);
    if (member.role === input.role) return toMember(member);

    if (member.role === 'admin') await assertNotLastAdmin(tx, auth.organizationId);
    if (input.role === 'viewer') await unassignOpenTickets(tx, auth.organizationId, member.id);

    const updated = await tx.user.update({
      where: { id: member.id },
      data: { role: input.role },
    });
    return toMember(updated);
  });
  // After the transaction committed. Clients refetch members (and tickets,
  // since demotion to Viewer may have unassigned some).
  deps.publisher.toOrg(auth.organizationId, 'members.changed');
  return result;
}

/**
 * Soft-deletes a member: they keep their name on past tickets and comments,
 * but lose access immediately because their tokenVersion changes.
 */
export async function removeMember(deps: Deps, auth: AuthContext, memberId: string): Promise<void> {
  requireAdmin(auth);
  if (memberId === auth.id) {
    throw conflict('CANNOT_REMOVE_SELF', 'You cannot remove yourself');
  }

  await deps.prisma.$transaction(async (tx) => {
    await lockOrganization(tx, auth.organizationId);
    const member = await findActiveMember(tx, auth.organizationId, memberId);
    if (member.role === 'admin') await assertNotLastAdmin(tx, auth.organizationId);

    await unassignOpenTickets(tx, auth.organizationId, member.id);
    await tx.user.update({
      where: { id: member.id },
      data: { removedAt: new Date(), tokenVersion: { increment: 1 } },
    });
  });
  // Cut the removed member's live connections right away, then tell the org.
  deps.publisher.disconnectUser(memberId);
  deps.publisher.toOrg(auth.organizationId, 'members.changed');
}
