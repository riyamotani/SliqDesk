import { Prisma } from '@prisma/client';
import type { CurrentUser, LoginInput, Role, SignupInput } from '@sliqdesk/shared';
import type { Deps } from '../deps.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import { signToken, verifyToken } from './token.js';

/**
 * Who is making the request. Built from the database on every request, never
 * from client input. `organizationId` here is the ONLY source of tenant
 * scoping for every query the request makes.
 */
export interface AuthContext {
  id: string;
  role: Role;
  organizationId: string;
  organizationName: string;
  name: string;
  email: string;
}

const userWithOrg = { organization: { select: { id: true, name: true } } } as const;
type UserWithOrg = Prisma.UserGetPayload<{ include: typeof userWithOrg }>;

function toAuthContext(user: UserWithOrg): AuthContext {
  return {
    id: user.id,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    name: user.name,
    email: user.email,
  };
}

export function toCurrentUser(auth: AuthContext): CurrentUser {
  return {
    id: auth.id,
    name: auth.name,
    email: auth.email,
    role: auth.role,
    organization: { id: auth.organizationId, name: auth.organizationName },
  };
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Creates a new organization with the signing-up user as its Admin. */
export async function signup(deps: Deps, input: SignupInput) {
  const passwordHash = await hashPassword(input.password);
  try {
    // Nested create = one transaction: either both rows exist or neither.
    const org = await deps.prisma.organization.create({
      data: {
        name: input.organizationName,
        users: {
          create: { email: input.email, name: input.name, passwordHash, role: 'admin' },
        },
      },
      include: { users: { include: userWithOrg } },
    });
    const user = org.users[0]!;
    return {
      auth: toAuthContext(user),
      token: signToken(deps.config, { userId: user.id, tokenVersion: user.tokenVersion }),
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function login(deps: Deps, input: LoginInput) {
  const user = await deps.prisma.user.findUnique({
    where: { email: input.email },
    include: userWithOrg,
  });
  const active = user && !user.removedAt ? user : null;

  // Always run bcrypt, even for unknown emails, so response time doesn't
  // reveal whether an email is registered.
  const ok = await verifyPassword(input.password, active?.passwordHash ?? DUMMY_HASH);
  if (!active || !ok) throw unauthorized('Invalid email or password');

  return {
    auth: toAuthContext(active),
    token: signToken(deps.config, { userId: active.id, tokenVersion: active.tokenVersion }),
  };
}

/**
 * Invalidates every token the user holds: tokens carry the old tokenVersion,
 * and resolveSession rejects any version that doesn't match the database.
 */
export async function logout(deps: Deps, userId: string): Promise<void> {
  await deps.prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  // Live sockets were authenticated with the old token: close them too.
  deps.publisher.disconnectUser(userId);
}

/**
 * Turns a session token into an AuthContext, or null if the token is invalid,
 * the user was removed, or the token was revoked (tokenVersion changed).
 * Used by both the REST middleware and the Socket.IO handshake.
 */
export async function resolveSession(
  deps: Pick<Deps, 'config' | 'prisma'>,
  token: string,
): Promise<AuthContext | null> {
  const payload = verifyToken(deps.config, token);
  if (!payload) return null;

  const user = await deps.prisma.user.findUnique({
    where: { id: payload.userId },
    include: userWithOrg,
  });
  if (!user || user.removedAt || user.tokenVersion !== payload.tokenVersion) return null;

  return toAuthContext(user);
}
