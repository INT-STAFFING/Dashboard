import { eq } from 'drizzle-orm';
import { getDb, hasDB } from './db';
import { users as usersTable } from './schema';
import { hashPassword } from './auth/password';
import type { Role, SafeUser, UserStatus } from './types';

export type UserRecord = {
  id: number;
  email: string;
  name: string | null;
  password_hash: string;
  role: Role;
  status: UserStatus;
  created_at: string | null;
  approved_at: string | null;
};

// ---------------------------------------------------------------------------
// Seed admin (always present, never deletable)
// ---------------------------------------------------------------------------
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@dashboard.local').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Amministratore';

// The seed admin is fully protected: cannot be deleted, demoted or rejected.
export function isProtectedAdmin(u: { email: string }): boolean {
  return u.email.toLowerCase() === ADMIN_EMAIL;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

function toSafe(u: UserRecord): SafeUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    created_at: u.created_at,
    approved_at: u.approved_at,
  };
}
export const toSafeUser = toSafe;

type Row = typeof usersTable.$inferSelect;
function rowToUser(r: Row): UserRecord {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    password_hash: r.password_hash,
    role: (r.role as Role) ?? 'USER',
    status: (r.status as UserStatus) ?? 'pending',
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    approved_at: r.approved_at ? new Date(r.approved_at).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// In-memory fallback store (used when no DB is configured)
// ---------------------------------------------------------------------------
const g = globalThis as unknown as {
  __ARIA_USERS__?: UserRecord[];
  __ARIA_USERS_SEQ__?: number;
  __ARIA_USERS_SEEDED__?: boolean;
};

function mem(): UserRecord[] {
  if (!g.__ARIA_USERS__) g.__ARIA_USERS__ = [];
  return g.__ARIA_USERS__;
}
function nextId(): number {
  g.__ARIA_USERS_SEQ__ = (g.__ARIA_USERS_SEQ__ ?? 0) + 1;
  return g.__ARIA_USERS_SEQ__;
}

// ---------------------------------------------------------------------------
// Seeding — make sure the protected ADMIN account always exists
// ---------------------------------------------------------------------------
let seedPromise: Promise<void> | null = null;

async function doSeed(): Promise<void> {
  const nowIso = new Date().toISOString();
  if (hasDB) {
    const existing = await getDb()
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, ADMIN_EMAIL));
    if (!existing[0]) {
      await getDb().insert(usersTable).values({
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        password_hash: hashPassword(ADMIN_PASSWORD),
        role: 'ADMIN',
        status: 'approved',
        approved_at: new Date(),
      });
    }
    return;
  }
  if (!mem().some((u) => u.email === ADMIN_EMAIL)) {
    mem().push({
      id: nextId(),
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      password_hash: hashPassword(ADMIN_PASSWORD),
      role: 'ADMIN',
      status: 'approved',
      created_at: nowIso,
      approved_at: nowIso,
    });
  }
}

export async function ensureSeed(): Promise<void> {
  // In DB mode re-check every cold start (cheap, idempotent); in-memory once.
  if (!hasDB) {
    if (g.__ARIA_USERS_SEEDED__) return;
    await doSeed();
    g.__ARIA_USERS_SEEDED__ = true;
    return;
  }
  if (!seedPromise) seedPromise = doSeed();
  return seedPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function listUsers(): Promise<SafeUser[]> {
  await ensureSeed();
  if (hasDB) {
    const rows = await getDb().select().from(usersTable);
    return rows.map(rowToUser).map(toSafe).sort(byCreated);
  }
  return mem().map(toSafe).sort(byCreated);
}
const byCreated = (a: SafeUser, b: SafeUser) =>
  (a.created_at || '').localeCompare(b.created_at || '');

export async function getUserById(id: number): Promise<UserRecord | null> {
  await ensureSeed();
  if (hasDB) {
    const rows = await getDb().select().from(usersTable).where(eq(usersTable.id, id));
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  return mem().find((u) => u.id === id) ?? null;
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  await ensureSeed();
  const e = normalizeEmail(email);
  if (hasDB) {
    const rows = await getDb().select().from(usersTable).where(eq(usersTable.email, e));
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  return mem().find((u) => u.email === e) ?? null;
}

export async function createUser(input: {
  email: string;
  name?: string | null;
  password: string;
  role?: Role;
}): Promise<SafeUser> {
  await ensureSeed();
  const email = normalizeEmail(input.email);
  if (await getUserByEmail(email)) {
    throw new Error('Email già registrata');
  }
  // Self-registration may only request USER or USERPLUS; ADMIN is never granted here.
  const role: Role = input.role === 'USERPLUS' ? 'USERPLUS' : 'USER';
  const password_hash = hashPassword(input.password);
  const nowIso = new Date().toISOString();

  if (hasDB) {
    const inserted = await getDb()
      .insert(usersTable)
      .values({ email, name: input.name ?? null, password_hash, role, status: 'pending' })
      .returning();
    return toSafe(rowToUser(inserted[0]));
  }
  const record: UserRecord = {
    id: nextId(),
    email,
    name: input.name ?? null,
    password_hash,
    role,
    status: 'pending',
    created_at: nowIso,
    approved_at: null,
  };
  mem().push(record);
  return toSafe(record);
}

async function patch(
  id: number,
  changes: Partial<Pick<UserRecord, 'role' | 'status' | 'approved_at'>>,
): Promise<SafeUser | null> {
  if (hasDB) {
    const updated = await getDb()
      .update(usersTable)
      .set({
        ...(changes.role !== undefined ? { role: changes.role } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.approved_at !== undefined
          ? { approved_at: changes.approved_at ? new Date(changes.approved_at) : null }
          : {}),
      })
      .where(eq(usersTable.id, id))
      .returning();
    return updated[0] ? toSafe(rowToUser(updated[0])) : null;
  }
  const u = mem().find((x) => x.id === id);
  if (!u) return null;
  if (changes.role !== undefined) u.role = changes.role;
  if (changes.status !== undefined) u.status = changes.status;
  if (changes.approved_at !== undefined) u.approved_at = changes.approved_at;
  return toSafe(u);
}

export async function approveUser(id: number): Promise<SafeUser | null> {
  return patch(id, { status: 'approved', approved_at: new Date().toISOString() });
}

export async function rejectUser(id: number): Promise<SafeUser | null> {
  const u = await getUserById(id);
  if (!u) return null;
  if (isProtectedAdmin(u)) throw new Error("Impossibile rifiutare l'amministratore protetto");
  return patch(id, { status: 'rejected', approved_at: null });
}

export async function setUserRole(id: number, role: Role): Promise<SafeUser | null> {
  const u = await getUserById(id);
  if (!u) return null;
  if (isProtectedAdmin(u) && role !== 'ADMIN') {
    throw new Error("Impossibile declassare l'amministratore protetto");
  }
  return patch(id, { role });
}

export async function deleteUser(id: number): Promise<boolean> {
  const u = await getUserById(id);
  if (!u) return false;
  if (u.role === 'ADMIN') {
    throw new Error('Un account ADMIN non può essere eliminato');
  }
  if (hasDB) {
    const res = await getDb()
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id });
    return res.length > 0;
  }
  const list = mem();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}
