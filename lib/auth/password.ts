// Password hashing with Node's built-in scrypt — no external dependencies.
// Only imported from Node runtime route handlers / server-side stores.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Stored format: "s1$<saltHex>$<hashHex>"
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `s1$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  const [, salt, hash] = parts;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
