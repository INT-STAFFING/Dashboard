// Password hashing with Node's built-in scrypt — no external dependencies.
// Only imported from Node runtime route handlers / server-side stores.
//
// scrypt runs on libuv's thread pool (async), so a login attempt doesn't block
// the event loop for its ~50–100 ms the way scryptSync did. The stored format
// and cost parameters are unchanged: hashes written by the old synchronous
// implementation still verify.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// Stored format: "s1$<saltHex>$<hashHex>"
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt)).toString('hex');
  return `s1$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  const [, salt, hash] = parts;
  const expected = Buffer.from(hash, 'hex');
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// A valid hash of a random password, computed once. Verifying against it when
// the account doesn't exist makes "unknown email" cost the same as "wrong
// password", so response time doesn't reveal which emails are registered.
let dummyHash: Promise<string> | null = null;
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash.then((h) => verifyPassword(password, h));
}
