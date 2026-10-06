// Per-instance cache of the user behind a session cookie.
//
// getSessionUser() runs on every page render and API call, and used to cost one
// database round-trip each time (neon-http: one HTTPS request). Role and status
// still have to be re-read from the store — the cookie only carries the user id
// — so instead of trusting the token for them, the looked-up user is kept for a
// short TTL.
//
// Revocation latency: a change made through the app (approve, reject, role
// change, delete, admin SQL console) invalidates the cache of the instance that
// served the request immediately; any OTHER warm instance keeps its copy for at
// most the TTL (default 30 s, SESSION_USER_CACHE_TTL_MS, 0 = disabled). Only
// positive lookups are cached, and only SafeUser (never the password hash).
import type { SafeUser } from '../types';

const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 500;

type Entry = { user: SafeUser; expires: number };
type State = {
  entries: Map<number, Entry>;
  inflight: Map<number, Promise<SafeUser | null>>;
  // Bumped on every invalidation: a load that started before one must not
  // repopulate the cache with what may already be stale data.
  epoch: number;
};

const g = globalThis as unknown as { __ARIA_USER_CACHE__?: State };
function state(): State {
  return (g.__ARIA_USER_CACHE__ ??= { entries: new Map(), inflight: new Map(), epoch: 0 });
}

export function userCacheTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SESSION_USER_CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
}

// Callers get a copy, so mutating the returned object can't corrupt the cache.
const copy = (u: SafeUser | null): SafeUser | null => (u ? { ...u } : null);

export async function getCachedUser(uid: number, load: () => Promise<SafeUser | null>): Promise<SafeUser | null> {
  const ttl = userCacheTtlMs();
  if (ttl === 0) return load();

  const s = state();
  const hit = s.entries.get(uid);
  if (hit) {
    if (hit.expires > Date.now()) return copy(hit.user);
    s.entries.delete(uid);
  }

  // Concurrent requests for the same user (page + parallel API calls) share one load.
  const pending = s.inflight.get(uid);
  if (pending) return copy(await pending);

  const epoch = s.epoch;
  const p: Promise<SafeUser | null> = load()
    .then((user) => {
      if (user && s.epoch === epoch) {
        if (s.entries.size >= MAX_ENTRIES) s.entries.delete(s.entries.keys().next().value as number);
        s.entries.set(uid, { user, expires: Date.now() + ttl });
      }
      return user;
    })
    .finally(() => {
      if (s.inflight.get(uid) === p) s.inflight.delete(uid);
    });
  s.inflight.set(uid, p);
  return copy(await p);
}

export function invalidateUser(uid: number): void {
  const s = state();
  s.entries.delete(uid);
  s.inflight.delete(uid);
  s.epoch++;
}

export function invalidateAllUsers(): void {
  const s = state();
  s.entries.clear();
  s.inflight.clear();
  s.epoch++;
}
