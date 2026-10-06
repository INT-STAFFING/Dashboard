import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeed, getUserByEmail, ADMIN_EMAIL } from '@/lib/users';
import { verifyPassword } from '@/lib/auth/password';

const KEYS = ['NODE_ENV', 'VERCEL_ENV', 'ADMIN_PASSWORD', 'ALLOW_INSECURE_CONFIG'];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS.slice(1)) delete process.env[k];
  const g = globalThis as Record<string, unknown>;
  delete g.__ARIA_USERS__;
  delete g.__ARIA_USERS_SEEDED__;
  delete g.__ARIA_USERS_SEQ__;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('seeded admin account', () => {
  it('REGRESSION: outside production it is created with the "admin" default', async () => {
    await ensureSeed();
    const admin = await getUserByEmail(ADMIN_EMAIL);
    expect(admin?.role).toBe('ADMIN');
    expect(await verifyPassword('admin', admin!.password_hash)).toBe(true);
  });

  it('is not created with the default password in production', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    await expect(ensureSeed()).rejects.toThrow(/ADMIN_PASSWORD/);
    process.env.ADMIN_PASSWORD = 'admin';
    await expect(ensureSeed()).rejects.toThrow(/ADMIN_PASSWORD/);
  });

  it('is created in production when ADMIN_PASSWORD is set, using that password', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.ADMIN_PASSWORD = 'una-password-di-produzione';
    await ensureSeed();
    const admin = await getUserByEmail(ADMIN_EMAIL);
    expect(await verifyPassword('una-password-di-produzione', admin!.password_hash)).toBe(true);
    expect(await verifyPassword('admin', admin!.password_hash)).toBe(false);
  });
});
