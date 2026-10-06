import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/upload/route';

const state = vi.hoisted(() => ({ user: null as null | { id: number; email: string; role: string; status: string } }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSessionUser: async () => state.user };
});
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const EDITOR = { id: 3, email: 'plus@x.it', role: 'USERPLUS', status: 'approved' };
const VIEWER = { id: 4, email: 'viewer@x.it', role: 'USER', status: 'approved' };

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.UPLOAD_SECRET;
  state.user = EDITOR;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.UPLOAD_SECRET;
  else process.env.UPLOAD_SECRET = savedSecret;
});

const upload = (query = '', headers: Record<string, string> = {}) =>
  POST(
    new Request(`http://localhost/api/upload${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ kind: 'dashboard', interventi: [] }),
    }),
  );

describe('POST /api/upload — secret handling', () => {
  it('REGRESSION: viewers cannot upload (403)', async () => {
    state.user = VIEWER;
    delete process.env.UPLOAD_SECRET;
    expect((await upload()).status).toBe(403);
  });

  it('REGRESSION: with no UPLOAD_SECRET configured an editor passes the gate', async () => {
    delete process.env.UPLOAD_SECRET;
    const res = await upload();
    expect([401, 403]).not.toContain(res.status);
  });

  it('accepts the secret in the x-upload-secret header', async () => {
    process.env.UPLOAD_SECRET = 's3cret';
    const res = await upload('', { 'x-upload-secret': 's3cret' });
    expect([401, 403]).not.toContain(res.status);
  });

  it('rejects a wrong or missing secret with 401', async () => {
    process.env.UPLOAD_SECRET = 's3cret';
    expect((await upload('', { 'x-upload-secret': 'wrong' })).status).toBe(401);
    expect((await upload()).status).toBe(401);
  });

  it('no longer accepts the secret as ?token= in the query string', async () => {
    process.env.UPLOAD_SECRET = 's3cret';
    expect((await upload('?token=s3cret')).status).toBe(401);
  });
});
