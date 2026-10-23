import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { signToken, verifyToken } from './token.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://unused',
  JWT_SECRET: 'unit-test-secret-1234567890',
});

describe('session tokens', () => {
  it('round-trips the user id and token version', () => {
    const token = signToken(config, { userId: 'user-1', tokenVersion: 3 });
    expect(verifyToken(config, token)).toEqual({ userId: 'user-1', tokenVersion: 3 });
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ ver: 0 }, 'some-other-secret-value', { subject: 'user-1' });
    expect(verifyToken(config, forged)).toBeNull();
  });

  it('rejects a tampered token', () => {
    const token = signToken(config, { userId: 'user-1', tokenVersion: 0 });
    const [header, , signature] = token.split('.');
    const fakePayload = Buffer.from(JSON.stringify({ sub: 'admin-of-other-org', ver: 0 })).toString(
      'base64url',
    );
    expect(verifyToken(config, `${header}.${fakePayload}.${signature}`)).toBeNull();
  });

  it('rejects an unsigned "alg: none" token', () => {
    const unsigned = jwt.sign({ ver: 0 }, '', { subject: 'user-1', algorithm: 'none' });
    expect(verifyToken(config, unsigned)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ ver: 0 }, config.JWT_SECRET, { subject: 'user-1', expiresIn: -10 });
    expect(verifyToken(config, expired)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyToken(config, 'not-a-jwt')).toBeNull();
  });
});
