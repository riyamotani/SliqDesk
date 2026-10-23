import {
  createCommentSchema,
  createTicketSchema,
  listTicketsQuerySchema,
  updateTicketSchema,
} from '@sliqdesk/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, getAuth } from '../auth/authenticate.js';
import type { Deps } from '../deps.js';
import { validate } from '../lib/validate.js';
import * as comments from './comments.service.js';
import * as tickets from './tickets.service.js';

const idParams = z.object({ id: z.string().uuid() });

export function ticketsRouter(deps: Deps): Router {
  const router = Router();
  router.use(authenticate(deps));

  router.get('/', async (req, res) => {
    const query = validate(listTicketsQuerySchema, req.query);
    res.json(await tickets.listTickets(deps, getAuth(req), query));
  });

  router.post('/', async (req, res) => {
    const input = validate(createTicketSchema, req.body);
    const ticket = await tickets.createTicket(deps, getAuth(req), input);
    res.status(201).json({ ticket });
  });

  router.get('/:id', async (req, res) => {
    const { id } = validate(idParams, req.params);
    res.json({ ticket: await tickets.getTicket(deps, getAuth(req), id) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = validate(idParams, req.params);
    const input = validate(updateTicketSchema, req.body);
    res.json({ ticket: await tickets.updateTicket(deps, getAuth(req), id, input) });
  });

  router.get('/:id/comments', async (req, res) => {
    const { id } = validate(idParams, req.params);
    res.json({ data: await comments.listComments(deps, getAuth(req), id) });
  });

  router.post('/:id/comments', async (req, res) => {
    const { id } = validate(idParams, req.params);
    const input = validate(createCommentSchema, req.body);
    const comment = await comments.addComment(deps, getAuth(req), id, input);
    res.status(201).json({ comment });
  });

  return router;
}
