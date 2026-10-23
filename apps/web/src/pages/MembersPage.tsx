import { ROLES, type Member, type Role } from '@sliqdesk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useCurrentUser } from '../auth';
import { useMembers } from '../queries';

/** Admin-only page (the route and the API both enforce that). */
export function MembersPage() {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const members = useMembers();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['members'] });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api(`/members/${id}`, { method: 'PATCH', body: { role } }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/members/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });

  function confirmRemove(member: Member) {
    if (window.confirm(`Remove ${member.name}? They will be logged out immediately.`)) {
      setError(null);
      remove.mutate(member.id);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Members</h1>
      </div>
      <AddMemberForm />
      {error && <p className="error">{error}</p>}
      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.data?.map((m) => (
            <tr key={m.id}>
              <td>
                {m.name} {m.id === me.id && <span className="muted">(you)</span>}
              </td>
              <td>{m.email}</td>
              <td>
                <select
                  value={m.role}
                  onChange={(e) => {
                    setError(null);
                    changeRole.mutate({ id: m.id, role: e.target.value as Role });
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {m.id !== me.id && (
                  <button className="danger" onClick={() => confirmRemove(m)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AddMemberForm() {
  const queryClient = useQueryClient();
  const empty = { name: '', email: '', role: 'agent' as Role, password: '' };
  const [form, setForm] = useState(empty);

  const add = useMutation({
    mutationFn: () => api<{ member: Member }>('/members', { method: 'POST', body: form }),
    onSuccess: () => {
      setForm(empty);
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2>Add a member</h2>
      <p className="muted">Share the initial password with them; they can log in right away.</p>
      <div className="row">
        <label>
          Name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </label>
        <label>
          Role
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Initial password
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </label>
      </div>
      {add.isError && <p className="error">{errorMessage(add.error)}</p>}
      <button type="submit" disabled={add.isPending}>
        Add member
      </button>
    </form>
  );
}
