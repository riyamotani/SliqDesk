import { createMemberSchema, updateMemberSchema } from '@sliqdesk/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, getAuth } from '../auth/authenticate.js';
import type { Deps } from '../deps.js';
import { validate } from '../lib/validate.js';
import * as members from './members.service.js';

const idParams = z.object({ id: z.string().uuid() });

export function membersRouter(deps: Deps): Router {
  const router = Router();
  router.use(authenticate(deps));

  // Every member can list the organization's members (needed for assignee
  // pickers and filters); only Admins can change them.
  router.get('/', async (req, res) => {
    res.json({ data: await members.listMembers(deps, getAuth(req)) });
  });

  router.post('/', async (req, res) => {
    const input = validate(createMemberSchema, req.body);
    const member = await members.addMember(deps, getAuth(req), input);
    res.status(201).json({ member });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = validate(idParams, req.params);
    const input = validate(updateMemberSchema, req.body);
    const member = await members.updateMemberRole(deps, getAuth(req), id, input);
    res.json({ member });
  });

  router.delete('/:id', async (req, res) => {
    const { id } = validate(idParams, req.params);
    await members.removeMember(deps, getAuth(req), id);
    res.status(204).end();
  });

  return router;
}
