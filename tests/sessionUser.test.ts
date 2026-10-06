import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionUser, createSessionToken } from '@/lib/auth';
import { signSession } from '@/lib/auth/session';
import { invalidateAllUsers } from '@/lib/auth/userCache';
import * as users from '@/lib/users';

const jar = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (jar.cookie ? { name, value: jar.cookie } : undefined) }),
}));
// Same implementation, but observable: how many times does a request reach the store?
vi.mock('@/lib/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/users')>();
  return { ...actual, getUserById: vi.fn(actual.getUserById) };
});

const asUser = async (id: number) => {
  jar.cookie = await createSessionToken(id);
};
const storeReads = () => vi.mocked(users.getUserById).mock.calls.length;

let savedTtl: string | undefined;
beforeEach(() => {
  savedTtl = process.env.SESSION_USER_CACHE_TTL_MS;
  delete process.env.SESSION_USER_CACHE_TTL_MS;
  invalidateAllUsers();
  vi.mocked(users.getUserById).mockClear();
  jar.cookie = undefined;
});
afterEach(() => {
  vi.useRealTimers();
  if (savedTtl === undefined) delete process.env.SESSION_USER_CACHE_TTL_MS;
  else process.env.SESSION_USER_CACHE_TTL_MS = savedTtl;
});

const newUser = async (email: string) => users.createUser({ email, password: 'secret-pw' });

describe('getSessionUser — behaviour that must not change', () => {
  it('returns null without a cookie, with garbage, and with an expired token', async () => {
    expect(await getSessionUser()).toBeNull();
    jar.cookie = 'not-a-token';
    expect(await getSessionUser()).toBeNull();
    jar.cookie = await signSession({ uid: 1, exp: Date.now() - 1000 });
    expect(await getSessionUser()).toBeNull();
  });

  it('returns the safe user (no password hash) for a valid session', async () => {
    const u = await newUser('safe@x.it');
    await asUser(u.id);
    const got = await getSessionUser();
    expect(got).toMatchObject({ id: u.id, email: 'safe@x.it', role: 'USER', status: 'pending' });
    expect(got).not.toHaveProperty('password_hash');
  });

  it('returns null for a token whose user does not exist, and does not cache that', async () => {
    await asUser(987654);
    expect(await getSessionUser()).toBeNull();
    expect(await getSessionUser()).toBeNull();
    expect(storeReads()).toBe(2);
  });
});

describe('getSessionUser — caching', () => {
  it('HOT PATH: repeated requests of an authenticated user reach the store once', async () => {
    const u = await newUser('hot@x.it');
    await asUser(u.id);
    for (let i = 0; i < 10; i++) await getSessionUser();
    expect(storeReads()).toBe(1);
  });

  it('is disabled with SESSION_USER_CACHE_TTL_MS=0', async () => {
    process.env.SESSION_USER_CACHE_TTL_MS = '0';
    const u = await newUser('nocache@x.it');
    await asUser(u.id);
    await getSessionUser();
    await getSessionUser();
    expect(storeReads()).toBe(2);
  });
});

describe('getSessionUser — changes made through the app take effect immediately', () => {
  it('approving a pending user', async () => {
    const u = await newUser('approve@x.it');
    await asUser(u.id);
    expect((await getSessionUser())?.status).toBe('pending');
    await users.approveUser(u.id);
    expect((await getSessionUser())?.status).toBe('approved');
  });

  it('rejecting an approved user', async () => {
    const u = await newUser('reject@x.it');
    await users.approveUser(u.id);
    await asUser(u.id);
    expect((await getSessionUser())?.status).toBe('approved');
    await users.rejectUser(u.id);
    expect((await getSessionUser())?.status).toBe('rejected');
  });

  it('changing a role (promotion and demotion)', async () => {
    const u = await newUser('role@x.it');
    await users.approveUser(u.id);
    await asUser(u.id);
    expect((await getSessionUser())?.role).toBe('USER');
    await users.setUserRole(u.id, 'USERPLUS');
    expect((await getSessionUser())?.role).toBe('USERPLUS');
    await users.setUserRole(u.id, 'USER');
    expect((await getSessionUser())?.role).toBe('USER');
  });

  it('deleting the account logs the session out', async () => {
    const u = await newUser('delete@x.it');
    await users.approveUser(u.id);
    await asUser(u.id);
    expect(await getSessionUser()).not.toBeNull();
    await users.deleteUser(u.id);
    expect(await getSessionUser()).toBeNull();
  });

  it("one user's change does not evict or leak into another user's cached entry", async () => {
    const a = await newUser('a@x.it');
    const b = await newUser('b@x.it');
    await asUser(a.id);
    await getSessionUser();
    await users.approveUser(b.id);
    vi.mocked(users.getUserById).mockClear();
    await getSessionUser();
    expect(storeReads()).toBe(0);
    await asUser(b.id);
    expect((await getSessionUser())?.status).toBe('approved');
  });
});

describe('getSessionUser — bounded staleness for changes made elsewhere', () => {
  it('a change that bypasses the app (another instance, direct SQL) shows up after the TTL, not before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const u = await newUser('stale@x.it');
    await asUser(u.id);
    expect((await getSessionUser())?.status).toBe('pending');

    // Change the row behind the cache's back (what another instance would do).
    const record = (globalThis as unknown as { __ARIA_USERS__: { id: number; status: string }[] }).__ARIA_USERS__.find((r) => r.id === u.id)!;
    record.status = 'approved';

    vi.setSystemTime(Date.now() + 29_000);
    expect((await getSessionUser())?.status).toBe('pending');
    vi.setSystemTime(Date.now() + 2_000);
    expect((await getSessionUser())?.status).toBe('approved');
  });
});
