import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  LOGIN_WINDOW_SEC,
  MAX_FAILS_PER_EMAIL,
  MAX_FAILS_PER_IP,
  checkLoginAllowed,
  clearLoginFailures,
  clientIp,
  recordLoginFailure,
} from '@/lib/auth/loginThrottle';
import { applyMigration, createTestDb } from './helpers/pglite';

const state = vi.hoisted(() => ({ hasDB: true, db: null as unknown }));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, get hasDB() { return state.hasDB; }, getDb: () => state.db, ensureSchema: async () => {} };
});

let pg: PGlite;
beforeAll(async () => {
  const t = await createTestDb();
  pg = t.pg;
  state.db = t.db;
  await applyMigration(pg, '0012_login_attempts_admin_audit.sql');
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  state.hasDB = true;
  await pg.exec('TRUNCATE login_attempts RESTART IDENTITY');
  delete (globalThis as Record<string, unknown>).__ARIA_LOGIN_ATTEMPTS__;
});

const who = (email = 'a@x.it', ip = '1.1.1.1') => ({ email, ip });
const fail = async (n: number, s = who()) => {
  for (let i = 0; i < n; i++) await recordLoginFailure(s);
};
const rows = async () => (await pg.query<{ n: number }>('select count(*)::int as n from login_attempts')).rows[0].n;

describe('clientIp', () => {
  it('takes the first X-Forwarded-For hop, then X-Real-IP, then "unknown"', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).toBe('9.9.9.9');
    expect(clientIp(new Headers({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8');
    expect(clientIp(new Headers())).toBe('unknown');
  });
  it('bounds an absurdly long header', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': 'a'.repeat(500) })).length).toBe(64);
  });
});

describe('login throttle — database mode', () => {
  it('allows a subject with no failures', async () => {
    expect(await checkLoginAllowed(who())).toEqual({ allowed: true });
  });

  it('still allows one failure short of the per-email limit', async () => {
    await fail(MAX_FAILS_PER_EMAIL - 1);
    expect((await checkLoginAllowed(who())).allowed).toBe(true);
  });

  it('blocks an email at the limit and reports a sensible Retry-After', async () => {
    await fail(MAX_FAILS_PER_EMAIL);
    const gate = await checkLoginAllowed(who());
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterSec).toBeGreaterThan(LOGIN_WINDOW_SEC - 30);
      expect(gate.retryAfterSec).toBeLessThanOrEqual(LOGIN_WINDOW_SEC);
    }
  });

  it('does not affect other emails coming from other IPs', async () => {
    await fail(MAX_FAILS_PER_EMAIL);
    expect((await checkLoginAllowed(who('b@x.it', '2.2.2.2'))).allowed).toBe(true);
  });

  it('blocks an IP that guesses across many emails, without blocking those emails elsewhere', async () => {
    for (let i = 0; i < MAX_FAILS_PER_IP; i++) await recordLoginFailure(who(`user${i}@x.it`, '3.3.3.3'));
    expect((await checkLoginAllowed(who('fresh@x.it', '3.3.3.3'))).allowed).toBe(false);
    expect((await checkLoginAllowed(who('user0@x.it', '4.4.4.4'))).allowed).toBe(true);
  });

  it('a successful login clears the email counter but not the IP counter', async () => {
    await fail(MAX_FAILS_PER_EMAIL);
    await clearLoginFailures('a@x.it');
    expect((await checkLoginAllowed(who())).allowed).toBe(true);
    const ipRows = (await pg.query<{ n: number }>("select count(*)::int as n from login_attempts where key like 'i:%'")).rows[0].n;
    expect(ipRows).toBe(MAX_FAILS_PER_EMAIL);
  });

  it('ignores attempts older than the window, and prunes them on the next failure', async () => {
    await pg.exec(
      `insert into login_attempts (key, created_at)
       select 'e:a@x.it', now() - interval '16 minutes' from generate_series(1, ${MAX_FAILS_PER_EMAIL + 5})`,
    );
    expect((await checkLoginAllowed(who())).allowed).toBe(true);
    await recordLoginFailure(who());
    expect(await rows()).toBe(2); // only the fresh e: and i: rows survive
  });

  it('fails open: an unreadable counter never locks users out, and recording never throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = state.db;
    state.db = { execute: async () => { throw new Error('db down'); }, batch: async () => { throw new Error('db down'); }, delete: () => { throw new Error('db down'); } };
    expect(await checkLoginAllowed(who())).toEqual({ allowed: true });
    await expect(recordLoginFailure(who())).resolves.toBeUndefined();
    await expect(clearLoginFailures('a@x.it')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    state.db = good;
    err.mockRestore();
  });
});

describe('login throttle — in-memory mode', () => {
  beforeEach(() => {
    state.hasDB = false;
  });

  it('blocks at the per-email limit and allows below it', async () => {
    await fail(MAX_FAILS_PER_EMAIL - 1);
    expect((await checkLoginAllowed(who())).allowed).toBe(true);
    await fail(1);
    expect((await checkLoginAllowed(who())).allowed).toBe(false);
  });

  it('un-blocks once the window has passed', async () => {
    vi.useFakeTimers();
    try {
      await fail(MAX_FAILS_PER_EMAIL);
      expect((await checkLoginAllowed(who())).allowed).toBe(false);
      vi.advanceTimersByTime((LOGIN_WINDOW_SEC + 1) * 1000);
      expect((await checkLoginAllowed(who())).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the email counter on success', async () => {
    await fail(MAX_FAILS_PER_EMAIL);
    await clearLoginFailures('a@x.it');
    expect((await checkLoginAllowed(who())).allowed).toBe(true);
  });
});
