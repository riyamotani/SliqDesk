import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';

export function SignupPage() {
  const { signup } = useAuth();
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(form);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Create your organization</h1>
      <p className="muted">You become its Admin and can invite your team.</p>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Organization name
          <input value={form.organizationName} onChange={set('organizationName')} required />
        </label>
        <label>
          Your name
          <input value={form.name} onChange={set('name')} autoComplete="name" required />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={set('email')}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password (at least 8 characters)
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create organization'}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
