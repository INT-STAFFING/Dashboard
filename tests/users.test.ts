import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applySchema } from '@/lib/db';
import {
  ADMIN_EMAIL,
  approveUser,
  createUser,
  deleteUser,
  ensureSeed,
  getUserByEmail,
  getUserById,
  isProtectedAdmin,
  listUsers,
  normalizeEmail,
  rejectUser,
  setUserRole,
  toSafeUser,
} from '@/lib/users';
import { verifyPassword } from '@/lib/auth/password';
import { createTestDb } from './helpers/pglite';

// Accounts are created/approved/promoted/deleted through the same API on the
// in-memory store and on a real Postgres. The ADMIN account is seeded once per
// instance (and survives table resets only in memory), so each test uses its own
// uniquely-named users instead of truncating the table.
const state = vi.hoisted(() => ({ hasDB: false, db: null as unknown }));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, get hasDB() { return state.hasDB; }, getDb: () => state.db, ensureSchema: async () => {} };
});

let pg: PGlite;
let n = 0;
const email = (tag = 'u') => `${tag}${++n}@x.it`;

describe('normalizeEmail / isProtectedAdmin / toSafeUser', () => {
  it('lower-cases and trims emails', () => {
    expect(normalizeEmail('  Mario.Rossi@X.IT ')).toBe('mario.rossi@x.it');
  });

  it('recognises the seeded admin by email, case-insensitively', () => {
    expect(isProtectedAdmin({ email: ADMIN_EMAIL.toUpperCase() })).toBe(true);
    expect(isProtectedAdmin({ email: 'other@x.it' })).toBe(false);
  });

  it('never exposes the password hash', () => {
    const safe = toSafeUser({ id: 1, email: 'a@x.it', name: 'A', password_hash: 's1$x$y', role: 'USER', status: 'pending', created_at: null, approved_at: null });
    expect(safe).not.toHaveProperty('password_hash');
    expect(safe).toMatchObject({ id: 1, email: 'a@x.it', role: 'USER' });
  });
});

describe.each(['memory', 'database'] as const)('%s backend', (backend) => {
  const isDb = backend === 'database';

  beforeAll(async () => {
    if (!isDb) return;
    const t = await createTestDb();
    pg = t.pg;
    state.db = t.db;
    state.hasDB = true;
    await applySchema(t.db as never);
  });
  afterAll(async () => {
    if (isDb) await pg.close();
  });
  beforeEach(() => {
    state.hasDB = isDb;
  });

  describe('the seeded administrator', () => {
    it('exists, approved, with the ADMIN role and a working password', async () => {
      await ensureSeed();
      const admin = await getUserByEmail(ADMIN_EMAIL);
      expect(admin).toMatchObject({ role: 'ADMIN', status: 'approved' });
      expect(await verifyPassword('admin', admin!.password_hash)).toBe(true);
    });

    it('is created once, however many times the seed runs', async () => {
      await ensureSeed();
      await ensureSeed();
      expect((await listUsers()).filter((u) => u.email === ADMIN_EMAIL)).toHaveLength(1);
      if (isDb) expect((await pg.query(`select 1 from users where email = $1`, [ADMIN_EMAIL])).rows).toHaveLength(1);
    });

    it('cannot be rejected, demoted or deleted', async () => {
      const admin = (await getUserByEmail(ADMIN_EMAIL))!;
      await expect(rejectUser(admin.id)).rejects.toThrow(/amministratore protetto/);
      await expect(setUserRole(admin.id, 'USER')).rejects.toThrow(/declassare/);
      await expect(deleteUser(admin.id)).rejects.toThrow(/ADMIN/);
      expect(await getUserByEmail(ADMIN_EMAIL)).toMatchObject({ role: 'ADMIN', status: 'approved' });
    });

    it('may be "promoted" to ADMIN again without error', async () => {
      const admin = (await getUserByEmail(ADMIN_EMAIL))!;
      expect(await setUserRole(admin.id, 'ADMIN')).toMatchObject({ role: 'ADMIN' });
    });
  });

  describe('registration', () => {
    it('creates a pending USER whose password is hashed, and finds it by email in any case', async () => {
      const e = email('reg');
      const u = await createUser({ email: e.toUpperCase(), name: 'Mario', password: 'secret-pw' });
      expect(u).toMatchObject({ email: e, name: 'Mario', role: 'USER', status: 'pending' });
      expect(u).not.toHaveProperty('password_hash');
      const stored = (await getUserByEmail(` ${e.toUpperCase()} `))!;
      expect(stored.id).toBe(u.id);
      expect(stored.password_hash).not.toContain('secret-pw');
      expect(await verifyPassword('secret-pw', stored.password_hash)).toBe(true);
      expect(await verifyPassword('wrong', stored.password_hash)).toBe(false);
    });

    it('REGRESSION: self-registration can ask for USERPLUS but never for ADMIN', async () => {
      expect((await createUser({ email: email(), password: 'secret-pw', role: 'USERPLUS' })).role).toBe('USERPLUS');
      expect((await createUser({ email: email(), password: 'secret-pw', role: 'ADMIN' })).role).toBe('USER');
    });

    it('refuses an email that is already registered, whatever its case', async () => {
      const e = email('dup');
      await createUser({ email: e, password: 'secret-pw' });
      await expect(createUser({ email: e.toUpperCase(), password: 'secret-pw' })).rejects.toThrow(/già registrata/);
    });

    it('stores a missing name as null', async () => {
      expect((await createUser({ email: email(), password: 'secret-pw' })).name).toBeNull();
    });
  });

  describe('lookups', () => {
    it('finds users by id and returns null for unknown ones', async () => {
      const u = await createUser({ email: email('id'), password: 'secret-pw' });
      expect((await getUserById(u.id))!.email).toBe(u.email);
      expect(await getUserById(999_999)).toBeNull();
      expect(await getUserByEmail('nobody@x.it')).toBeNull();
    });

    it('lists accounts without hashes, oldest first', async () => {
      const a = await createUser({ email: email('l1'), password: 'secret-pw' });
      const b = await createUser({ email: email('l2'), password: 'secret-pw' });
      const list = await listUsers();
      expect(list.every((u) => !('password_hash' in u))).toBe(true);
      const ids = list.map((u) => u.id);
      expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    });
  });

  describe('moderation', () => {
    it('approves a pending account and stamps the approval time', async () => {
      const u = await createUser({ email: email('ap'), password: 'secret-pw' });
      const approved = (await approveUser(u.id))!;
      expect(approved).toMatchObject({ status: 'approved' });
      expect(approved.approved_at).toBeTruthy();
      expect((await getUserById(u.id))!.status).toBe('approved');
    });

    it('rejects an account and clears its approval time', async () => {
      const u = await createUser({ email: email('rj'), password: 'secret-pw' });
      await approveUser(u.id);
      const rejected = (await rejectUser(u.id))!;
      expect(rejected).toMatchObject({ status: 'rejected', approved_at: null });
    });

    it('changes roles in both directions', async () => {
      const u = await createUser({ email: email('rl'), password: 'secret-pw' });
      expect((await setUserRole(u.id, 'USERPLUS'))!.role).toBe('USERPLUS');
      expect((await setUserRole(u.id, 'ADMIN'))!.role).toBe('ADMIN');
      expect((await getUserById(u.id))!.role).toBe('ADMIN');
    });

    it('answers null/false for accounts that do not exist', async () => {
      expect(await approveUser(999_999)).toBeNull();
      expect(await rejectUser(999_999)).toBeNull();
      expect(await setUserRole(999_999, 'USER')).toBeNull();
      expect(await deleteUser(999_999)).toBe(false);
    });

    it('deletes a non-admin account, once', async () => {
      const u = await createUser({ email: email('del'), password: 'secret-pw' });
      expect(await deleteUser(u.id)).toBe(true);
      expect(await getUserById(u.id)).toBeNull();
      expect(await deleteUser(u.id)).toBe(false);
    });

    it('refuses to delete any ADMIN, not just the seeded one', async () => {
      const u = await createUser({ email: email('adm'), password: 'secret-pw' });
      await setUserRole(u.id, 'ADMIN');
      await expect(deleteUser(u.id)).rejects.toThrow(/ADMIN/);
    });
  });
});
