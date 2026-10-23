import { canManageMembers } from '@sliqdesk/shared';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useCurrentUser, useAuth } from '../auth';
import { useRealtime } from '../realtime';

export function Layout({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const live = useRealtime(user.id);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          SliqDesk <span className="muted">· {user.organization.name}</span>
        </div>
        <nav>
          <NavLink to="/" end>
            Tickets
          </NavLink>
          {canManageMembers(user) && <NavLink to="/members">Members</NavLink>}
        </nav>
        <div className="me">
          <span
            className={`live-dot ${live ? 'on' : ''}`}
            title={live ? 'Live updates connected' : 'Reconnecting…'}
          />
          <span>{user.name}</span>
          <span className={`badge role-${user.role}`}>{user.role}</span>
          <button className="link" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
