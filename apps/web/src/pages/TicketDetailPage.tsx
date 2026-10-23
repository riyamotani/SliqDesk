import {
  canComment,
  canUpdateTicket,
  STATUS_TRANSITIONS,
  TICKET_PRIORITIES,
  type Comment,
  type CurrentUser,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
  type UpdateTicketInput,
} from '@sliqdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, HttpError } from '../api';
import { useCurrentUser } from '../auth';
import { PriorityBadge, SlaBadge, StatusBadge } from '../components/Badges';
import { formatDateTime, PRIORITY_LABELS, STATUS_LABELS } from '../format';
import { useAssignableMembers } from '../queries';

export function TicketDetailPage() {
  const { id = '' } = useParams();
  const user = useCurrentUser();

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => (await api<{ ticket: Ticket }>(`/tickets/${id}`)).ticket,
  });

  if (ticket.isLoading) return <p className="muted">Loading…</p>;
  if (ticket.isError) {
    const notFound = ticket.error instanceof HttpError && ticket.error.status === 404;
    return (
      <div>
        <p className="error">{notFound ? 'Ticket not found.' : errorMessage(ticket.error)}</p>
        <Link to="/">Back to tickets</Link>
      </div>
    );
  }
  const t = ticket.data!;

  return (
    <>
      <p>
        <Link to="/">← Tickets</Link>
      </p>
      <div className="page-header">
        <h1>{t.title}</h1>
      </div>
      <div className="badges">
        <StatusBadge status={t.status} />
        <PriorityBadge priority={t.priority} />
        <SlaBadge ticket={t} />
      </div>
      <p className="muted">
        Opened by {t.createdBy.name} on {formatDateTime(t.createdAt)} · Assignee:{' '}
        {t.assignee?.name ?? 'unassigned'}
      </p>
      {t.description && <p className="description">{t.description}</p>}

      {canUpdateTicket(user, { status: t.status, assigneeId: t.assignee?.id ?? null }) ? (
        <EditTicket key={t.updatedAt} ticket={t} />
      ) : (
        <p className="readonly-note">{readOnlyReason(user, t)}</p>
      )}

      <Comments ticket={t} />
    </>
  );
}

/** Why the controls are hidden. The API enforces the same rules. */
function readOnlyReason(user: CurrentUser, ticket: Ticket): string {
  if (ticket.status === 'closed') return 'This ticket is closed and can no longer be changed.';
  if (user.role === 'viewer') return 'Viewers can follow tickets but not change them.';
  return 'Only the assignee or an Admin can change this ticket.';
}

function EditTicket({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient();
  const assignable = useAssignableMembers();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [assigneeId, setAssigneeId] = useState(ticket.assignee?.id ?? '');

  // Only send what changed; the server ignores unchanged fields anyway.
  const changes: UpdateTicketInput = {};
  if (status !== ticket.status) changes.status = status;
  if (priority !== ticket.priority) changes.priority = priority;
  if ((assigneeId || null) !== (ticket.assignee?.id ?? null))
    changes.assigneeId = assigneeId || null;
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () =>
      api<{ ticket: Ticket }>(`/tickets/${ticket.id}`, { method: 'PATCH', body: changes }),
    onSuccess: ({ ticket: updated }) => {
      queryClient.setQueryData(['ticket', updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (err) => {
      // Someone else changed it first: load the latest version.
      if (err instanceof HttpError && err.code === 'TICKET_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form className="card row edit-ticket" onSubmit={onSubmit}>
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
          {/* Only the current status and the moves the workflow allows. */}
          {[ticket.status, ...STATUS_TRANSITIONS[ticket.status]].map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>
          {assignable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={!dirty || save.isPending}>
        Save
      </button>
      {save.isError && <p className="error">{errorMessage(save.error)}</p>}
    </form>
  );
}

function Comments({ ticket }: { ticket: Ticket }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const comments = useQuery({
    queryKey: ['comments', ticket.id],
    queryFn: async () => (await api<{ data: Comment[] }>(`/tickets/${ticket.id}/comments`)).data,
  });

  const add = useMutation({
    mutationFn: () =>
      api<{ comment: Comment }>(`/tickets/${ticket.id}/comments`, {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['comments', ticket.id] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  const mayComment = canComment(user) && ticket.status !== 'closed';

  return (
    <section className="comments">
      <h2>Comments</h2>
      {comments.data?.length === 0 && <p className="muted">No comments yet.</p>}
      <ul>
        {comments.data?.map((c) => (
          <li key={c.id} className="comment">
            <div className="comment-meta">
              <strong>{c.author.name}</strong>{' '}
              <span className="muted">{formatDateTime(c.createdAt)}</span>
            </div>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>
      {mayComment ? (
        <form onSubmit={onSubmit} className="stack">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            rows={3}
            maxLength={5000}
            required
          />
          {add.isError && <p className="error">{errorMessage(add.error)}</p>}
          <button type="submit" disabled={add.isPending || !body.trim()}>
            Add comment
          </button>
        </form>
      ) : (
        <p className="muted">
          {ticket.status === 'closed'
            ? 'Closed tickets do not accept comments.'
            : 'Viewers cannot comment.'}
        </p>
      )}
    </section>
  );
}
