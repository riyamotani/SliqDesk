import {
  canCreateTicket,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type Paginated,
  type Ticket,
  type TicketPriority,
} from '@sliqdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useCurrentUser } from '../auth';
import { PriorityBadge, SlaBadge, StatusBadge } from '../components/Badges';
import { formatDateTime, PRIORITY_LABELS, STATUS_LABELS } from '../format';
import { useAssignableMembers } from '../queries';

const PAGE_SIZE = 10;

export function TicketsPage() {
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const assignable = useAssignableMembers();

  // Filters live in the URL, so they survive a refresh and can be shared.
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const assigneeId = params.get('assigneeId') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) query.set('status', status);
  if (priority) query.set('priority', priority);
  if (assigneeId) query.set('assigneeId', assigneeId);

  const tickets = useQuery({
    queryKey: ['tickets', query.toString()],
    queryFn: () => api<Paginated<Ticket>>(`/tickets?${query.toString()}`),
    placeholderData: (previous) => previous,
  });

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page'); // a new filter starts at page 1
    setParams(next);
  }

  function goToPage(p: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  }

  const totalPages = tickets.data ? Math.max(1, Math.ceil(tickets.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="page-header">
        <h1>Tickets</h1>
      </div>

      {canCreateTicket(user) && <NewTicketForm />}

      <div className="filters">
        <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setFilter('priority', e.target.value)}>
          <option value="">All priorities</option>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select value={assigneeId} onChange={(e) => setFilter('assigneeId', e.target.value)}>
          <option value="">Any assignee</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {assignable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {tickets.isError && <p className="error">{errorMessage(tickets.error)}</p>}
      {tickets.data && tickets.data.data.length === 0 && (
        <p className="muted">No tickets match these filters.</p>
      )}
      {tickets.data && tickets.data.data.length > 0 && (
        <table className="tickets">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>SLA</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {tickets.data.data.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/tickets/${t.id}`}>{t.title}</Link>
                </td>
                <td>
                  <StatusBadge status={t.status} />
                </td>
                <td>
                  <PriorityBadge priority={t.priority} />
                </td>
                <td>{t.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
                <td>
                  <SlaBadge ticket={t} />
                </td>
                <td className="muted">{formatDateTime(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tickets.data && tickets.data.total > 0 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {totalPages} · {tickets.data.total} tickets
          </span>
          <button disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}

function NewTicketForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const assignable = useAssignableMembers();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [assigneeId, setAssigneeId] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api<{ ticket: Ticket }>('/tickets', {
        method: 'POST',
        body: { title, description, priority, assigneeId: assigneeId || null },
      }),
    onSuccess: ({ ticket }) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${ticket.id}`);
    },
  });

  if (!open) {
    return (
      <button className="new-ticket" onClick={() => setOpen(true)}>
        + New ticket
      </button>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2>New ticket</h2>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <label>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={5000}
        />
      </label>
      <div className="row">
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
      </div>
      {(priority === 'high' || priority === 'urgent') && (
        <p className="hint">
          High and urgent tickets must get a reply from an Admin or Agent in time.
        </p>
      )}
      {create.isError && <p className="error">{errorMessage(create.error)}</p>}
      <div className="row">
        <button type="submit" disabled={create.isPending}>
          Create ticket
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
