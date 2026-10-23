import type { Member } from '@sliqdesk/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Members of the current organization (used for assignee pickers and the members page). */
export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: async () => (await api<{ data: Member[] }>('/members')).data,
  });
}

/** Admins and Agents: the only roles that can be assigned tickets. */
export function useAssignableMembers() {
  const members = useMembers();
  return (members.data ?? []).filter((m) => m.role === 'admin' || m.role === 'agent');
}
