import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const required = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'a-long-enough-secret' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(required);
    expect(config.PORT).toBe(4000);
    expect(config.SLA_MINUTES).toBe(2);
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('parses numbers and booleans from strings', () => {
    const config = loadConfig({ ...required, SLA_MINUTES: '0.5', COOKIE_SECURE: 'true' });
    expect(config.SLA_MINUTES).toBe(0.5);
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('fails fast with a clear message when something is wrong', () => {
    expect(() => loadConfig({ ...required, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ JWT_SECRET: 'a-long-enough-secret' })).toThrow(/DATABASE_URL/);
  });
});
