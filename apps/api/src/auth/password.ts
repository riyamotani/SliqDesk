import bcrypt from 'bcryptjs';

// Cost factor 10 = 2^10 hashing rounds: roughly 50-100 ms per hash. Slow on
// purpose, so stolen hashes are expensive to brute-force.
const ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A real hash of a throwaway value. Login compares against it when the email
 * doesn't exist, so "unknown email" and "wrong password" take the same time
 * and an attacker can't discover which emails have accounts.
 */
export const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', ROUNDS);
