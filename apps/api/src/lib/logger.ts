import { pino } from 'pino';

export function createLogger(level: string, nodeEnv: string) {
  return pino({
    level,
    // Human-readable logs locally, JSON in production (for log aggregators).
    transport: nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  });
}

export type Logger = ReturnType<typeof createLogger>;
