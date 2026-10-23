import type { ZodType, ZodTypeDef } from 'zod';
import { badRequest } from './errors.js';

/** Parses untrusted input with a Zod schema, or throws a 400 listing what is wrong. */
export function validate<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw badRequest('Invalid request', details);
  }
  return result.data;
}
