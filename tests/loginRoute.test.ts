import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/auth/login/route';
import { MAX_FAILS_PER_EMAIL } from '@/lib/auth/loginThrottle';
import { createUser, approveUser, ADMIN_EMAIL } from '@/lib/users';

// No DATABASE_URL in the test environment: users and throttle counters live in
// the per-process in-memory stores, exactly the zero-config mode of the app.
let ipSeq = 0;
const login = (body: unknown, ip = `10.0.0.${++ipSeq}`) =>
  POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const adminLogin = (password: string, ip?: string) => login({ email: ADMIN_EMAIL, password }, ip);

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__ARIA_LOGIN_ATTEMPTS__;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/auth/login', () => {
  it('REGRESSION: valid credentials log in and set the httpOnly session cookie', async () => {
    const res = await adminLogin('admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user).toMatchObject({ email: ADMIN_EMAIL, role: 'ADMIN' });
    expect(body.user.password_hash).toBeUndefined();
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/aria_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('REGRESSION: rejects wrong password and unknown email with the same 401 and message', async () => {
    const wrong = await adminLogin('nope');
    const unknown = await login({ email: 'ghost@x.it', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error).toBe((await unknown.json()).error);
  });

  it('REGRESSION: validates the request body', async () => {
    expect((await login('not json')).status).toBe(400);
    expect((await login({ email: '', password: '' })).status).toBe(400);
  });

  it('REGRESSION: pending accounts get 403 with their status, and that is not counted as a failed guess', async () => {
    await createUser({ email: 'pending@x.it', password: 'secret-pw' });
    const ip = '172.16.0.9';
    for (let i = 0; i < MAX_FAILS_PER_EMAIL + 2; i++) {
      const res = await login({ email: 'pending@x.it', password: 'secret-pw' }, ip);
      expect(res.status).toBe(403);
      expect((await res.json()).status).toBe('pending');
    }
  });

  it('approved users created through the async hashing path can log in', async () => {
    const u = await createUser({ email: 'new@x.it', password: 'secret-pw' });
    await approveUser(u.id);
    expect((await login({ email: 'new@x.it', password: 'secret-pw' })).status).toBe(200);
  });

  it('blocks with 429 + Retry-After after too many failures — even for the correct password', async () => {
    const ip = '192.168.1.50';
    for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) expect((await adminLogin('bad', ip)).status).toBe(401);
    const blocked = await adminLogin('admin', ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await blocked.json()).ok).toBe(false);
  });

  it('the block is per email: another account from another IP is unaffected', async () => {
    for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) await adminLogin('bad', '192.168.2.1');
    expect((await adminLogin('bad', '192.168.2.1')).status).toBe(429);
    const u = await createUser({ email: 'other@x.it', password: 'secret-pw' });
    await approveUser(u.id);
    expect((await login({ email: 'other@x.it', password: 'secret-pw' }, '192.168.2.2')).status).toBe(200);
  });

  it('a successful login resets the failure counter', async () => {
    const ip = '192.168.3.1';
    for (let i = 0; i < MAX_FAILS_PER_EMAIL - 1; i++) await adminLogin('bad', ip);
    expect((await adminLogin('admin', ip)).status).toBe(200);
    for (let i = 0; i < MAX_FAILS_PER_EMAIL - 1; i++) expect((await adminLogin('bad', ip)).status).toBe(401);
  });

  it('emails are matched case-insensitively for throttling', async () => {
    const ip = '192.168.4.1';
    for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) {
      await login({ email: i % 2 ? ADMIN_EMAIL.toUpperCase() : ADMIN_EMAIL, password: 'bad' }, ip);
    }
    expect((await adminLogin('admin', ip)).status).toBe(429);
  });
});
