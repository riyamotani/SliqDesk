# SliqDesk

A small multi-tenant support desk: organizations, members with roles, tickets, comments, live
updates and SLA alerts. Node.js (Express) API + React frontend, started with one
`docker compose up`.

> **Work in progress.** This README grows with the code. See
> [Implementation status](#implementation-status) for what works today.

## Contents

- [SliqDesk](#sliqdesk)
  - [Contents](#contents)
  - [Setup](#setup)
    - [Local development (current)](#local-development-current)
    - [Checks](#checks)
  - [Architecture](#architecture)
  - [Key decisions](#key-decisions)
    - [Data model and tenant isolation (so far)](#data-model-and-tenant-isolation-so-far)
  - [API](#api)
  - [Implementation status](#implementation-status)
  - [Assumptions](#assumptions)
  - [Next steps](#next-steps)
  - [AI usage](#ai-usage)

## Setup

_To be completed once the full Docker setup lands._ Planned:

```bash
docker compose up        # starts Postgres, Redis, API, worker and web app
```

### Local development (current)

Requires Node 22+ and Docker.

```bash
npm install                                  # installs all workspaces, builds shared, generates Prisma client
docker compose up -d postgres redis          # database + Redis
cp .env.example apps/api/.env                # local configuration (working defaults)
npm run db:deploy -w @sliqdesk/api           # apply database migrations
npm run dev -w @sliqdesk/api                 # API on http://localhost:4000 (restarts on save)
```

### Checks

```bash
npm test               # unit tests (no database needed)
npm run test:integration   # API tests against Postgres (needs `docker compose up -d postgres`)
npm run lint           # ESLint
npm run format:check   # Prettier
npm run typecheck      # TypeScript
```

## Architecture

_Diagram and component overview to come._

Repository layout:

```
packages/shared   Domain rules shared by API and web: roles, statuses, transitions,
                  permission checks, Zod request schemas, DTO and event types
apps/api          Express API, Socket.IO server and the SLA worker (separate entry point)
apps/web          React frontend (Vite)
```

## Key decisions

| Area             | Choice                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| Language         | TypeScript everywhere, with a shared package for rules and types             |
| Database         | PostgreSQL + Prisma                                                          |
| Tenant isolation | Shared tables with `organizationId`, scoped queries, composite FKs           |
| Auth             | JWT in an httpOnly cookie carrying `tokenVersion`; user reloaded per request |
| SLA processing   | BullMQ delayed jobs in a separate worker + periodic safety-net sweep         |
| Real time        | Socket.IO, one room per organization, Redis adapter                          |

_Each decision and its trade-offs will be written up here._

### Data model and tenant isolation (so far)

- Every business table has an `organizationId` column.
- Tickets and comments use **composite foreign keys** `(id, organizationId)`, so the database
  rejects a ticket assigned to a user from another organization, or a comment on another
  organization's ticket, even if application code had a bug.
- Indexes start with `organizationId` to match how every query is scoped, then the filter
  column, then `createdAt` for newest-first pagination.
- Members are **soft-deleted** (`removedAt`), so their name stays on historical tickets and
  comments; the database also refuses to hard-delete a user who authored content.

## API

_Endpoint list to come._

## Implementation status

| Requirement                            | Status      | Notes                                   |
| -------------------------------------- | ----------- | --------------------------------------- |
| Data model and migrations              | Done        | Organizations, users, tickets, comments |
| Shared roles, transitions, permissions | Done        | With unit tests                         |
| Sign up, log in, log out               | Done        | Logout revokes the token server-side    |
| Member management                      | Done        | Last-admin protection, race-safe        |
| Tickets (CRUD, filters, pagination)    | Not started |                                         |
| Comments                               | Not started |                                         |
| Real-time updates                      | Not started |                                         |
| SLA alert                              | Not started |                                         |
| Frontend                               | Not started |                                         |
| One-command Docker setup               | Partial     | Postgres and Redis only so far          |
| Seed data                              | Not started |                                         |

## Assumptions

- **Emails are globally unique.** A user belongs to exactly one organization, so login needs
  only email and password.
- **Removing a member is a soft delete.** They lose access immediately, their open assignments
  are cleared, and their past tickets and comments keep their name. Adding the same email to
  the same organization again reactivates them.
- **New members get an initial password from the Admin** (no email infrastructure required).
- **Every member can list their organization's members** (needed for assignee pickers and
  filters); only Admins can add, change or remove members.
- **An organization always keeps at least one Admin**, and Admins cannot remove themselves.
  Member changes lock the organization row, so two Admins demoting each other at once cannot
  leave it without an Admin.
- **Demoting a member to Viewer unassigns their open tickets**, since Viewers cannot work
  tickets. Closed tickets keep their assignee because closed tickets are frozen.
- **Agents can assign tickets they may edit to any Admin or Agent** in their organization.
  Viewers can never be assignees.
- **Status transitions:** `open → in_progress | resolved | closed`,
  `in_progress → open | resolved | closed`, `resolved → open | in_progress | closed`;
  `closed` is final.

## Next steps

_To come._

## AI usage

_To be completed._ Notes so far:

- **Tool:** Claude Code in VS Code, used for scaffolding and reviewing design options.
- **Corrections I made:**
  - `prisma` was first listed as a devDependency, but the container needs the CLI at startup to
    run migrations, so a production install (`--omit=dev`) would have broken
    `docker compose up`. Moved it to `dependencies`.
- **Design input:** the auth approach (JWT carrying a `tokenVersion`, user reloaded on every
  request) was my proposal; the AI helped sharpen how its trade-offs are explained.
