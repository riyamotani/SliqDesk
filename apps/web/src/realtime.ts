import type { ServerToClientEvents, Ticket } from '@sliqdesk/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ME_KEY } from './auth';
import { useToast } from './toasts';

/**
 * Keeps the screen in sync with changes made by others. One socket per
 * logged-in user; the server decides which organization's events it gets.
 *
 * Events update the React Query cache, so every page showing that data
 * re-renders on its own. Returns whether the live connection is up.
 */
export function useRealtime(userId: string | undefined): boolean {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const socket: Socket<ServerToClientEvents> = io({
      path: '/socket.io',
      transports: ['websocket'],
    });
    let connectedBefore = false;

    const putTicket = (ticket: Ticket) => {
      queryClient.setQueryData(['ticket', ticket.id], ticket);
      // Lists depend on filters and sort order, so just refetch them.
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    };

    socket.on('connect', () => {
      setConnected(true);
      // Events sent while we were offline are lost (fire-and-forget), so
      // after a reconnect refetch everything from the source of truth.
      if (connectedBefore) void queryClient.invalidateQueries();
      connectedBefore = true;
    });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      // The server closed us on purpose (logout elsewhere or removal):
      // re-check the session, which sends us to the login page.
      if (reason === 'io server disconnect') {
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
      }
    });

    socket.on('ticket.created', ({ ticket }) => putTicket(ticket));
    socket.on('ticket.updated', ({ ticket }) => putTicket(ticket));
    socket.on('ticket.sla_breached', ({ ticket }) => {
      putTicket(ticket);
      toast(`SLA breached: "${ticket.title}" has no reply from the team yet`, 'alert');
    });
    socket.on('comment.created', ({ comment }) => {
      void queryClient.invalidateQueries({ queryKey: ['comments', comment.ticketId] });
    });
    socket.on('members.changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      // My own role may have changed, and demotions can unassign tickets.
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    });

    return () => {
      socket.disconnect();
    };
  }, [userId, queryClient, toast]);

  return connected;
}
