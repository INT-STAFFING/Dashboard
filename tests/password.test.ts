import { describe, expect, it } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '@/lib/auth/password';

// Hash exactly as the previous synchronous implementation did.
function legacyHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `s1$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

describe('password hashing', () => {
  it('round-trips and uses the s1$salt$hash format', async () => {
    const h = await hashPassword('correct horse');
    expect(h).toMatch(/^s1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword('correct horse', h)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong', await hashPassword('right'))).toBe(false);
  });

  it('REGRESSION: verifies hashes written by the old synchronous implementation', async () => {
    expect(await verifyPassword('legacy-pw', legacyHash('legacy-pw'))).toBe(true);
    expect(await verifyPassword('other', legacyHash('legacy-pw'))).toBe(false);
  });

  it('REGRESSION: hashes it produces can be verified by the legacy algorithm', async () => {
    const [, salt, hash] = (await hashPassword('pw')).split('$');
    expect(scryptSync('pw', salt, 64).toString('hex')).toBe(hash);
  });

  it('gives different hashes for the same password (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it.each(['', 'garbage', 's2$aa$bb', 's1$onlytwo', 's1$salt$nothex!!'])('rejects malformed stored value %j', async (stored) => {
    expect(await verifyPassword('pw', stored)).toBe(false);
  });

  it('does not block the event loop while hashing', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    await Promise.all([hashPassword('a'), hashPassword('b'), hashPassword('c')]);
    clearInterval(timer);
    // scryptSync would hold the loop for the whole duration (~tens of ms): no tick could fire.
    expect(ticks).toBeGreaterThan(2);
  });

  it('verifyAgainstDummy always fails but costs a real verification', async () => {
    const t0 = performance.now();
    expect(await verifyAgainstDummy('anything')).toBe(false);
    expect(await verifyAgainstDummy('anything')).toBe(false);
    expect(performance.now() - t0).toBeGreaterThan(5);
  });
});
