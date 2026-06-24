import { cookies } from 'next/headers';
import { getUserById, toSafeUser } from '../users';
import { verifySession, SESSION_COOKIE } from './session';
import type { SafeUser } from '../types';

// Resolve the current user from the session cookie. Always re-reads the user
// from the store so role/status changes (e.g. admin approval) take effect
// immediately, without waiting for the session to expire.
export async function getSessionUser(): Promise<SafeUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  const u = await getUserById(payload.uid);
  return u ? toSafeUser(u) : null;
}

export { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from './session';
export * from './permissions';
