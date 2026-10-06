import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedUser, invalidateAllUsers, invalidateUser, userCacheTtlMs } from '@/lib/auth/userCache';
import type { SafeUser } from '@/lib/types';

const user = (id: number, over: Partial<SafeUser> = {}): SafeUser => ({
  id,
  email: `u${id}@x.it`,
  name: null,
  role: 'USER',
  status: 'approved',
  created_at: null,
  approved_at: null,
  ...over,
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

let savedTtl: string | undefined;
beforeEach(() => {
  savedTtl = process.env.SESSION_USER_CACHE_TTL_MS;
  delete process.env.SESSION_USER_CACHE_TTL_MS;
  invalidateAllUsers();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  if (savedTtl === undefined) delete process.env.SESSION_USER_CACHE_TTL_MS;
  else process.env.SESSION_USER_CACHE_TTL_MS = savedTtl;
});

describe('userCacheTtlMs', () => {
  it('defaults to 30 s and accepts 0 (disabled) or a custom value', () => {
    expect(userCacheTtlMs({})).toBe(30_000);
    expect(userCacheTtlMs({ SESSION_USER_CACHE_TTL_MS: '' })).toBe(30_000);
    expect(userCacheTtlMs({ SESSION_USER_CACHE_TTL_MS: '0' })).toBe(0);
    expect(userCacheTtlMs({ SESSION_USER_CACHE_TTL_MS: '5000' })).toBe(5000);
  });
  it.each(['abc', '-1', 'NaN'])('falls back to the default for invalid value %s', (v) => {
    expect(userCacheTtlMs({ SESSION_USER_CACHE_TTL_MS: v })).toBe(30_000);
  });
});

describe('getCachedUser', () => {
  it('loads once and serves repeated lookups from the cache', async () => {
    const load = vi.fn(async () => user(1));
    for (let i = 0; i < 5; i++) expect(await getCachedUser(1, load)).toMatchObject({ id: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps users apart', async () => {
    const load1 = vi.fn(async () => user(1));
    const load2 = vi.fn(async () => user(2));
    expect((await getCachedUser(1, load1))?.id).toBe(1);
    expect((await getCachedUser(2, load2))?.id).toBe(2);
    expect((await getCachedUser(1, load1))?.id).toBe(1);
    expect(load1).toHaveBeenCalledTimes(1);
    expect(load2).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has passed, and not before', async () => {
    const load = vi.fn(async () => user(1));
    await getCachedUser(1, load);
    vi.setSystemTime(Date.now() + 29_000);
    await getCachedUser(1, load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2_000);
    await getCachedUser(1, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidateUser forces a reload for that user only', async () => {
    const load1 = vi.fn(async () => user(1));
    const load2 = vi.fn(async () => user(2));
    await getCachedUser(1, load1);
    await getCachedUser(2, load2);
    invalidateUser(1);
    await getCachedUser(1, load1);
    await getCachedUser(2, load2);
    expect(load1).toHaveBeenCalledTimes(2);
    expect(load2).toHaveBeenCalledTimes(1);
  });

  it('invalidateAllUsers forces every user to reload', async () => {
    const load1 = vi.fn(async () => user(1));
    const load2 = vi.fn(async () => user(2));
    await getCachedUser(1, load1);
    await getCachedUser(2, load2);
    invalidateAllUsers();
    await getCachedUser(1, load1);
    await getCachedUser(2, load2);
    expect(load1).toHaveBeenCalledTimes(2);
    expect(load2).toHaveBeenCalledTimes(2);
  });

  it('concurrent lookups of the same user share a single load', async () => {
    const gate = deferred<SafeUser>();
    const load = vi.fn(() => gate.promise);
    const all = Promise.all([getCachedUser(1, load), getCachedUser(1, load), getCachedUser(1, load)]);
    gate.resolve(user(1));
    const results = await all;
    expect(load).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r?.id === 1)).toBe(true);
  });

  it('RACE: a load that was in flight during an invalidation is not cached, and later callers do not join it', async () => {
    const stale = deferred<SafeUser>();
    const loadStale = vi.fn(() => stale.promise);
    const first = getCachedUser(1, loadStale); // reads the pre-change row…
    invalidateUser(1); // …a role change lands and invalidates meanwhile
    const loadFresh = vi.fn(async () => user(1, { role: 'ADMIN' }));
    expect((await getCachedUser(1, loadFresh))?.role).toBe('ADMIN'); // does not join the stale load
    stale.resolve(user(1, { role: 'USER' }));
    await first;
    // The stale result must not have overwritten the fresh entry.
    expect((await getCachedUser(1, vi.fn(async () => user(1, { role: 'XX' as never }))))?.role).toBe('ADMIN');
  });

  it('does not cache a missing user', async () => {
    const load = vi.fn(async () => null);
    expect(await getCachedUser(9, load)).toBeNull();
    expect(await getCachedUser(9, load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load, and propagates the error', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(user(1));
    await expect(getCachedUser(1, load)).rejects.toThrow('db down');
    expect((await getCachedUser(1, load))?.id).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is disabled by SESSION_USER_CACHE_TTL_MS=0 (previous behaviour: always hits the store)', async () => {
    process.env.SESSION_USER_CACHE_TTL_MS = '0';
    const load = vi.fn(async () => user(1));
    await getCachedUser(1, load);
    await getCachedUser(1, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('hands out copies: mutating a result does not change what the next caller sees', async () => {
    const load = vi.fn(async () => user(1));
    const a = (await getCachedUser(1, load))!;
    a.role = 'ADMIN';
    expect((await getCachedUser(1, load))?.role).toBe('USER');
  });

  it('stays bounded: old entries are evicted past the size cap', async () => {
    const loads = new Map<number, ReturnType<typeof vi.fn>>();
    for (let id = 1; id <= 520; id++) {
      const l = vi.fn(async () => user(id));
      loads.set(id, l);
      await getCachedUser(id, l);
    }
    await getCachedUser(1, loads.get(1)!); // evicted -> loads again
    await getCachedUser(520, loads.get(520)!); // recent -> still cached
    expect(loads.get(1)).toHaveBeenCalledTimes(2);
    expect(loads.get(520)).toHaveBeenCalledTimes(1);
  });
});
