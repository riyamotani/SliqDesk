import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at
 * startup, so a missing or malformed value fails fast with a clear message
 * instead of causing confusing errors later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_TTL_HOURS: z.coerce
    .number()
    .positive()
    .default(24 * 7),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // How long a high/urgent ticket may wait for an Admin/Agent comment.
  // Decimals are allowed (0.5 = 30 seconds) so reviewers can see alerts quickly.
  SLA_MINUTES: z.coerce.number().positive().default(2),
  // How often the worker sweeps for overdue tickets as a safety net.
  SLA_SWEEP_SECONDS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
