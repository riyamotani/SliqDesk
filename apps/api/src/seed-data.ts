import type { PrismaClient, Role, TicketPriority, TicketStatus } from '@prisma/client';
import { hashPassword } from './auth/password.js';
import { addMinutes } from './sla/sla.rules.js';

/**
 * Demo data: two organizations, each with one Admin, Agent and Viewer and a
 * few tickets. Idempotent: if the first seeded user exists, nothing happens,
 * so it is safe to run on every container start.
 *
 * Logins (password for all: password123):
 *   admin@acme.test   agent@acme.test   viewer@acme.test
 *   admin@globex.test agent@globex.test viewer@globex.test
 */
export const SEED_PASSWORD = 'password123';

interface SeedTicket {
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: 'admin' | 'agent';
  /** Comments as [author, body]; staff comments count as the SLA response. */
  comments?: ['admin' | 'agent', string][];
  /** high/urgent only: minutes from now until the SLA deadline (negative = already breached). */
  slaInMinutes?: number;
}

const ORGS: { name: string; domain: string; tickets: SeedTicket[] }[] = [
  {
    name: 'Acme Support',
    domain: 'acme.test',
    tickets: [
      {
        title: 'Checkout page returns 500',
        description: 'Customers report an error when paying with a saved card.',
        status: 'open',
        priority: 'urgent',
        // Becomes overdue shortly after start-up: the worker's sweep flags it.
        slaInMinutes: 2,
      },
      {
        title: 'Cannot reset password',
        description: 'The reset email never arrives for some Gmail addresses.',
        status: 'in_progress',
        priority: 'high',
        assignee: 'agent',
        comments: [['agent', 'Reproduced with a test account, checking the mail provider logs.']],
      },
      {
        title: 'Export to CSV misses the last row',
        description: 'Off-by-one in the monthly export.',
        status: 'open',
        priority: 'medium',
      },
      {
        title: 'Typo on the pricing page',
        description: '"Proffesional" should be "Professional".',
        status: 'resolved',
        priority: 'low',
        assignee: 'agent',
        comments: [['agent', 'Fixed in the latest deploy.']],
      },
      {
        title: 'Duplicate invoice emails',
        description: 'Some customers got the same invoice twice.',
        status: 'open',
        priority: 'high',
        // Already overdue: shows the "SLA breached" state right away.
        slaInMinutes: -30,
      },
    ],
  },
  {
    name: 'Globex Help',
    domain: 'globex.test',
    tickets: [
      {
        title: 'VPN disconnects every hour',
        description: 'Happens on the office network only.',
        status: 'in_progress',
        priority: 'high',
        assignee: 'admin',
        comments: [['admin', 'Looks like a DHCP lease issue, investigating.']],
      },
      {
        title: 'New laptop for the design team',
        description: 'Two MacBooks needed by next month.',
        status: 'open',
        priority: 'low',
      },
      {
        title: 'Shared drive is read-only',
        description: 'Nobody can save files to the Projects folder.',
        status: 'open',
        priority: 'urgent',
        slaInMinutes: 5,
      },
      {
        title: 'Printer on floor 3 jams',
        description: 'Replaced the tray, still jamming.',
        status: 'closed',
        priority: 'medium',
        assignee: 'agent',
        comments: [['agent', 'Vendor replaced the roller. Closing.']],
      },
    ],
  },
];

const ROLES: Role[] = ['admin', 'agent', 'viewer'];

export async function seed(prisma: PrismaClient): Promise<boolean> {
  const marker = `admin@${ORGS[0]!.domain}`;
  if (await prisma.user.findUnique({ where: { email: marker } })) return false;

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const now = new Date();

  for (const orgSpec of ORGS) {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: orgSpec.name } });
      const users = {} as Record<Role, { id: string }>;
      for (const role of ROLES) {
        users[role] = await tx.user.create({
          data: {
            organizationId: org.id,
            email: `${role}@${orgSpec.domain}`,
            name: `${role[0]!.toUpperCase()}${role.slice(1)} ${orgSpec.name.split(' ')[0]}`,
            role,
            passwordHash,
          },
        });
      }

      for (const [i, t] of orgSpec.tickets.entries()) {
        const createdAt = new Date(now.getTime() - (orgSpec.tickets.length - i) * 3_600_000);
        const hasStaffComment = (t.comments ?? []).length > 0;
        const slaDueAt = t.slaInMinutes === undefined ? null : addMinutes(now, t.slaInMinutes);
        const ticket = await tx.ticket.create({
          data: {
            organizationId: org.id,
            createdById: users.agent.id,
            assigneeId: t.assignee ? users[t.assignee].id : null,
            title: t.title,
            description: t.description,
            status: t.status,
            priority: t.priority,
            createdAt,
            slaDueAt,
            slaBreachedAt: t.slaInMinutes !== undefined && t.slaInMinutes < 0 ? slaDueAt : null,
            firstResponseAt: hasStaffComment ? addMinutes(createdAt, 10) : null,
          },
        });
        for (const [author, body] of t.comments ?? []) {
          await tx.comment.create({
            data: {
              organizationId: org.id,
              ticketId: ticket.id,
              authorId: users[author].id,
              body,
              createdAt: addMinutes(createdAt, 10),
            },
          });
        }
      }
    });
  }
  return true;
}
