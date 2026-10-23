import type { CurrentUser, LoginInput, SignupInput } from '@sliqdesk/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api, HttpError } from './api';

interface AuthState {
  user: CurrentUser | null;
  isLoading: boolean;
  login(input: LoginInput): Promise<void>;
  signup(input: SignupInput): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const ME_KEY = ['me'] as const;

/**
 * Asks the server who is logged in (GET /auth/me). The answer lives in the
 * React Query cache under ['me'], so any part of the app can invalidate it,
 * e.g. when a real-time event says our role may have changed.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await api<{ user: CurrentUser }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) return null;
        throw err;
      }
    },
  });

  const state: AuthState = {
    user: me.data ?? null,
    isLoading: me.isLoading,
    async login(input) {
      const { user } = await api<{ user: CurrentUser }>('/auth/login', {
        method: 'POST',
        body: input,
      });
      queryClient.setQueryData(ME_KEY, user);
    },
    async signup(input) {
      const { user } = await api<{ user: CurrentUser }>('/auth/signup', {
        method: 'POST',
        body: input,
      });
      queryClient.setQueryData(ME_KEY, user);
    },
    async logout() {
      try {
        await api('/auth/logout', { method: 'POST' });
      } finally {
        // Log out locally even if the request failed. Order matters: update
        // 'me' in place (the app is subscribed to that cache entry), then drop
        // everything else the previous user loaded. Calling clear() first
        // would delete the entry the app listens to, leaving it on screen.
        queryClient.setQueryData(ME_KEY, null);
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      }
    },
  };

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The logged-in user, for pages that are only rendered when logged in. */
export function useCurrentUser(): CurrentUser {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser used while logged out');
  return user;
}
