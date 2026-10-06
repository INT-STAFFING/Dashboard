import { cookies } from 'next/headers';
import { getUserById, toSafeUser } from '../users';
import { verifySession, SESSION_COOKIE } from './session';
import { getCachedUser } from './userCache';
import type { SafeUser } from '../types';

// Resolve the current user from the session cookie. The cookie only proves
// *who* the user is; role/status come from the store so that approvals and role
// changes take effect without waiting for the session to expire. That lookup is
// cached briefly per instance (see userCache.ts): changes made through the app
// invalidate it at once on the serving instance, and other warm instances catch
// up within the TTL.
export async function getSessionUser(): Promise<SafeUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  return getCachedUser(payload.uid, async () => {
    const u = await getUserById(payload.uid);
    return u ? toSafeUser(u) : null;
  });
}

export { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from './session';
export * from './permissions';
