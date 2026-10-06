import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DB_URL_ENV_KEYS,
  assertAdminPasswordSecure,
  assertProductionConfig,
  configProblems,
  isProductionRuntime,
  resolveAuthSecret,
  resolveConnectionString,
} from '@/lib/security/config';
import { createSessionToken, getAuthSecret, signSession, verifySession } from '@/lib/auth/session';
import { register } from '@/instrumentation';

const GOOD = { AUTH_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db', NODE_ENV: 'production' };

describe('isProductionRuntime', () => {
  it.each([
    [{ VERCEL_ENV: 'production' }, true],
    [{ VERCEL_ENV: 'preview', NODE_ENV: 'production' }, false],
    [{ VERCEL_ENV: 'development', NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{}, false],
  ])('%j -> %s', (env, expected) => {
    expect(isProductionRuntime(env)).toBe(expected);
  });
});

describe('resolveConnectionString (regression: same aliases and priority as before)', () => {
  it('returns an empty string when nothing is set', () => {
    expect(resolveConnectionString({})).toBe('');
  });
  it.each(DB_URL_ENV_KEYS.map((k) => [k]))('accepts %s', (key) => {
    expect(resolveConnectionString({ [key]: 'postgres://x' })).toBe('postgres://x');
  });
  it('prefers DATABASE_URL over POSTGRES_URL and pooled over unpooled', () => {
    expect(resolveConnectionString({ POSTGRES_URL: 'b', DATABASE_URL: 'a' })).toBe('a');
    expect(resolveConnectionString({ DATABASE_URL_UNPOOLED: 'u', POSTGRES_URL: 'p' })).toBe('p');
  });
});

describe('resolveAuthSecret', () => {
  it('outside production keeps the developer fallback chain (regression)', () => {
    expect(resolveAuthSecret({ AUTH_SECRET: 'a', UPLOAD_SECRET: 'u' })).toBe('a');
    expect(resolveAuthSecret({ UPLOAD_SECRET: 'u' })).toBe('u');
    expect(resolveAuthSecret({})).toMatch(/insecure/);
  });
  it('in production never falls back to UPLOAD_SECRET', () => {
    expect(resolveAuthSecret({ NODE_ENV: 'production', UPLOAD_SECRET: 'u' })).toBe('');
    expect(resolveAuthSecret({ NODE_ENV: 'production', AUTH_SECRET: 'a', UPLOAD_SECRET: 'u' })).toBe('a');
  });
});

describe('configProblems', () => {
  it('accepts a complete configuration', () => {
    expect(configProblems(GOOD)).toEqual([]);
  });
  it('flags a missing AUTH_SECRET', () => {
    expect(configProblems({ ...GOOD, AUTH_SECRET: undefined }).join()).toMatch(/AUTH_SECRET/);
  });
  it.each(['aria-siss-dev-insecure-secret-change-me', 'cambia_questo_in_produzione'])('flags the shipped default %s', (v) => {
    expect(configProblems({ ...GOOD, AUTH_SECRET: v }).join()).toMatch(/AUTH_SECRET/);
  });
  it('flags AUTH_SECRET equal to UPLOAD_SECRET', () => {
    expect(configProblems({ ...GOOD, UPLOAD_SECRET: GOOD.AUTH_SECRET }).join()).toMatch(/UPLOAD_SECRET/);
  });
  it('flags a missing database, but accepts any of its aliases', () => {
    expect(configProblems({ ...GOOD, DATABASE_URL: undefined }).join()).toMatch(/database/);
    expect(configProblems({ ...GOOD, DATABASE_URL: undefined, DASH_POSTGRES_URL: 'postgres://x' })).toEqual([]);
  });
  it('reports every problem at once', () => {
    expect(configProblems({ NODE_ENV: 'production' })).toHaveLength(2);
  });
});

describe('assertProductionConfig', () => {
  it('throws in production when the configuration is unsafe', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'production' }, () => {})).toThrow(/AUTH_SECRET/);
    expect(() => assertProductionConfig({ VERCEL_ENV: 'production' }, () => {})).toThrow();
  });
  it('passes in production when everything is configured', () => {
    expect(() => assertProductionConfig(GOOD, () => {})).not.toThrow();
  });
  it('only warns on previews and in development (they keep working unconfigured)', () => {
    const warn = vi.fn();
    expect(() => assertProductionConfig({ VERCEL_ENV: 'preview' }, warn)).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: 'development' }, warn)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });
  it('honours the explicit ALLOW_INSECURE_CONFIG escape hatch, still warning', () => {
    const warn = vi.fn();
    expect(() => assertProductionConfig({ NODE_ENV: 'production', ALLOW_INSECURE_CONFIG: 'true' }, warn)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('assertAdminPasswordSecure', () => {
  it('refuses the default or an unset ADMIN_PASSWORD in production', () => {
    expect(() => assertAdminPasswordSecure({ NODE_ENV: 'production' })).toThrow(/ADMIN_PASSWORD/);
    expect(() => assertAdminPasswordSecure({ NODE_ENV: 'production', ADMIN_PASSWORD: 'admin' })).toThrow();
  });
  it('accepts a custom password in production, and anything outside production (regression)', () => {
    expect(() => assertAdminPasswordSecure({ NODE_ENV: 'production', ADMIN_PASSWORD: 'una-password-lunga' })).not.toThrow();
    expect(() => assertAdminPasswordSecure({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertAdminPasswordSecure({ VERCEL_ENV: 'preview', ADMIN_PASSWORD: 'admin' })).not.toThrow();
  });
});

// The session module and instrumentation read process.env directly.
describe('session secret + instrumentation against process.env', () => {
  const KEYS = ['NODE_ENV', 'VERCEL_ENV', 'AUTH_SECRET', 'UPLOAD_SECRET', 'ALLOW_INSECURE_CONFIG', ...DB_URL_ENV_KEYS];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });
  const set = (env: Record<string, string>) => Object.assign(process.env, env);

  it('REGRESSION: outside production a session can still be signed and verified with the dev secret', async () => {
    const token = await createSessionToken(7);
    expect(await verifySession(token)).toMatchObject({ uid: 7 });
  });

  it('REGRESSION: sign/verify roundtrip with an explicit secret, and tampering is rejected', async () => {
    const token = await signSession({ uid: 1, exp: Date.now() + 60_000 }, 'k'.repeat(32));
    expect(await verifySession(token, 'k'.repeat(32))).toMatchObject({ uid: 1 });
    expect(await verifySession(token, 'z'.repeat(32))).toBeNull();
    expect(await verifySession(token.replace(/^./, 'A'), 'k'.repeat(32))).toBeNull();
  });

  it('production without AUTH_SECRET refuses to sign, even if UPLOAD_SECRET is set', async () => {
    set({ NODE_ENV: 'production', UPLOAD_SECRET: 'something-else-entirely' });
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);
    await expect(createSessionToken(1)).rejects.toThrow(/AUTH_SECRET/);
  });

  it('production with a real AUTH_SECRET works', async () => {
    set({ NODE_ENV: 'production', AUTH_SECRET: 'a-long-random-production-secret-value' });
    expect(await verifySession(await createSessionToken(3))).toMatchObject({ uid: 3 });
  });

  it('ALLOW_INSECURE_CONFIG keeps a production build usable locally (non-empty key)', async () => {
    set({ NODE_ENV: 'production', ALLOW_INSECURE_CONFIG: 'true' });
    expect(getAuthSecret().length).toBeGreaterThan(0);
    expect(await verifySession(await createSessionToken(4))).toMatchObject({ uid: 4 });
  });

  it('instrumentation register() aborts startup in production with an unsafe config', async () => {
    set({ NODE_ENV: 'production' });
    await expect(register()).rejects.toThrow(/Configurazione non sicura/);
  });

  it('instrumentation register() passes with a safe production config and on previews', async () => {
    set({ NODE_ENV: 'production', AUTH_SECRET: 'a-long-random-production-secret-value', DATABASE_URL: 'postgres://x' });
    await expect(register()).resolves.toBeUndefined();
    delete process.env.AUTH_SECRET;
    delete process.env.DATABASE_URL;
    set({ VERCEL_ENV: 'preview' });
    await expect(register()).resolves.toBeUndefined();
  });
});
