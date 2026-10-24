import type { PrismaClient, Role, TicketPriority, TicketStatus } from '@prisma/client';
import { hashPassword } from './auth/password.js';
import { addMinutes, initialSlaDueAt } from './sla/sla.rules.js';

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
  /** How long before the seed ran the ticket was created. */
  createdMinutesAgo: number;
  assignee?: 'admin' | 'agent';
  /** Comments as [author, body]; staff comments count as the SLA response. */
  comments?: ['admin' | 'agent', string][];
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
        // Just created and unanswered: it becomes overdue SLA_MINUTES after
        // start-up, when the worker's sweep flags it and alerts Acme live.
        createdMinutesAgo: 0,
      },
      {
        title: 'Duplicate invoice emails',
        description: 'Some customers got the same invoice twice.',
        status: 'open',
        priority: 'high',
        // Unanswered for 45 minutes: already overdue when the app starts.
        createdMinutesAgo: 45,
      },
      {
        title: 'Cannot reset password',
        description: 'The reset email never arrives for some Gmail addresses.',
        status: 'in_progress',
        priority: 'high',
        createdMinutesAgo: 90,
        assignee: 'agent',
        comments: [['agent', 'Reproduced with a test account, checking the mail provider logs.']],
      },
      {
        title: 'Export to CSV misses the last row',
        description: 'Off-by-one in the monthly export.',
        status: 'open',
        priority: 'medium',
        createdMinutesAgo: 180,
      },
      {
        title: 'Typo on the pricing page',
        description: '"Proffesional" should be "Professional".',
        status: 'resolved',
        priority: 'low',
        createdMinutesAgo: 26 * 60,
        assignee: 'agent',
        comments: [['agent', 'Fixed in the latest deploy.']],
      },
    ],
  },
  {
    name: 'Globex Help',
    domain: 'globex.test',
    tickets: [
      {
        title: 'Shared drive is read-only',
        description: 'Nobody can save files to the Projects folder.',
        status: 'open',
        priority: 'urgent',
        // Like Acme's checkout ticket: overdue SLA_MINUTES after start-up.
        createdMinutesAgo: 0,
      },
      {
        title: 'VPN disconnects every hour',
        description: 'Happens on the office network only.',
        status: 'in_progress',
        priority: 'high',
        createdMinutesAgo: 120,
        assignee: 'admin',
        comments: [['admin', 'Looks like a DHCP lease issue, investigating.']],
      },
      {
        title: 'New laptop for the design team',
        description: 'Two MacBooks needed by next month.',
        status: 'open',
        priority: 'low',
        createdMinutesAgo: 2 * 24 * 60,
      },
      {
        title: 'Printer on floor 3 jams',
        description: 'Replaced the tray, still jamming.',
        status: 'closed',
        priority: 'medium',
        createdMinutesAgo: 3 * 24 * 60,
        assignee: 'agent',
        comments: [['agent', 'Vendor replaced the roller. Closing.']],
      },
    ],
  },
];

const ROLES: Role[] = ['admin', 'agent', 'viewer'];

/**
 * SLA fields follow the same rules as the app: high/urgent tickets are due
 * `slaMinutes` after creation, a staff comment within that window satisfies
 * the SLA, and an unanswered ticket past its deadline is already breached.
 */
export async function seed(
  prisma: PrismaClient,
  slaMinutes = Number(process.env.SLA_MINUTES) || 2,
): Promise<boolean> {
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

      for (const t of orgSpec.tickets) {
        const createdAt = addMinutes(now, -t.createdMinutesAgo);
        const slaDueAt = initialSlaDueAt(t.priority, createdAt, slaMinutes);
        // Staff replies land halfway through the SLA window, so "SLA met" is true.
        const repliedAt = addMinutes(createdAt, slaMinutes / 2);
        const answered = (t.comments ?? []).length > 0;
        const breached = slaDueAt !== null && !answered && slaDueAt <= now;

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
            firstResponseAt: answered ? repliedAt : null,
            slaBreachedAt: breached ? slaDueAt : null,
          },
        });
        for (const [author, body] of t.comments ?? []) {
          await tx.comment.create({
            data: {
              organizationId: org.id,
              ticketId: ticket.id,
              authorId: users[author].id,
              body,
              createdAt: repliedAt,
            },
          });
        }
      }
    });
  }
  return true;
}
