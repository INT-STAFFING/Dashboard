// Brute-force protection for POST /api/auth/login.
//
// Failed attempts are recorded per email ("e:<email>") and per client IP
// ("i:<ip>") in the login_attempts table, so the limit holds across serverless
// instances; without a database a per-instance in-memory map is used. A key is
// blocked once it has reached its limit of failures inside the sliding window,
// and un-blocks when the oldest of them ages out. A successful login clears the
// email's counter.
//
// Trade-off: anyone can lock a *known email* out of the login form for up to
// one window by failing on purpose; existing sessions are unaffected. The
// per-email limit is therefore kept above what a person mistypes in a row.
//
// Fail-open on purpose: if the counters can't be read or written, the login
// proceeds (the error is logged) — an infrastructure hiccup in the throttle
// must not lock every user out.
import { lt, sql } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from '../db';
import { login_attempts } from '../schema';

export const LOGIN_WINDOW_SEC = 15 * 60;
export const MAX_FAILS_PER_EMAIL = 10;
export const MAX_FAILS_PER_IP = 30;

export type LoginSubject = { email: string; ip: string };
export type LoginGate = { allowed: true } | { allowed: false; retryAfterSec: number };

const emailKey = (s: LoginSubject) => `e:${s.email}`;
const ipKey = (s: LoginSubject) => `i:${s.ip}`;
const limitFor = (key: string) => (key.startsWith('e:') ? MAX_FAILS_PER_EMAIL : MAX_FAILS_PER_IP);

// First hop of X-Forwarded-For (set by Vercel's edge, not client-controlled
// there), then X-Real-IP. Bounded so a garbage header can't create huge keys.
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || headers.get('x-real-ip')?.trim() || 'unknown';
  return ip.slice(0, 64);
}

// --- in-memory fallback -----------------------------------------------------
const g = globalThis as unknown as { __ARIA_LOGIN_ATTEMPTS__?: Map<string, number[]> };
function mem(): Map<string, number[]> {
  if (!g.__ARIA_LOGIN_ATTEMPTS__) g.__ARIA_LOGIN_ATTEMPTS__ = new Map();
  return g.__ARIA_LOGIN_ATTEMPTS__;
}
function recent(key: string, now: number): number[] {
  const windowMs = LOGIN_WINDOW_SEC * 1000;
  const live = (mem().get(key) ?? []).filter((t) => now - t < windowMs);
  if (live.length) mem().set(key, live);
  else mem().delete(key);
  return live;
}

export async function checkLoginAllowed(subject: LoginSubject): Promise<LoginGate> {
  const keys = [emailKey(subject), ipKey(subject)];
  try {
    const retries: number[] = [];
    if (hasDB) {
      await ensureSchema();
      const res = (await getDb().execute(
        sql`select key, count(*)::int as n,
                   extract(epoch from (min(created_at) + ${LOGIN_WINDOW_SEC}::int * interval '1 second' - now()))::int as retry
              from login_attempts
             where key in (${keys[0]}, ${keys[1]})
               and created_at > now() - ${LOGIN_WINDOW_SEC}::int * interval '1 second'
             group by key`,
      )) as unknown as { rows?: { key: string; n: number; retry: number }[] } | { key: string; n: number; retry: number }[];
      const rows = Array.isArray(res) ? res : res.rows ?? [];
      for (const r of rows) if (Number(r.n) >= limitFor(r.key)) retries.push(Number(r.retry));
    } else {
      const now = Date.now();
      for (const key of keys) {
        const live = recent(key, now);
        if (live.length >= limitFor(key)) {
          retries.push(Math.ceil((live[0] + LOGIN_WINDOW_SEC * 1000 - now) / 1000));
        }
      }
    }
    if (retries.length) return { allowed: false, retryAfterSec: Math.max(1, ...retries) };
  } catch (e) {
    console.error('[login-throttle] check failed, allowing the attempt', e);
  }
  return { allowed: true };
}

export async function recordLoginFailure(subject: LoginSubject): Promise<void> {
  const keys = [emailKey(subject), ipKey(subject)];
  try {
    if (hasDB) {
      await ensureSchema();
      const db = getDb();
      // One round-trip: record the failure and drop rows that left the window.
      await db.batch([
        db.insert(login_attempts).values(keys.map((key) => ({ key }))),
        db.delete(login_attempts).where(lt(login_attempts.created_at, sql`now() - ${LOGIN_WINDOW_SEC}::int * interval '1 second'`)),
      ]);
    } else {
      const now = Date.now();
      for (const key of keys) mem().set(key, [...recent(key, now), now]);
    }
  } catch (e) {
    console.error('[login-throttle] could not record the failed attempt', e);
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  const key = `e:${email}`;
  try {
    if (hasDB) {
      await ensureSchema();
      await getDb().delete(login_attempts).where(sql`${login_attempts.key} = ${key}`);
    } else {
      mem().delete(key);
    }
  } catch (e) {
    console.error('[login-throttle] could not clear the counter', e);
  }
}
