// Stateless, signed session tokens. Uses the Web Crypto API only, so this
// module is safe to import from both the Edge middleware and Node route
// handlers / server components.
//
// Token format:  base64url(JSON payload) "." base64url(HMAC-SHA256)
// Payload carries only the user id + expiry; role/status are always looked up
// fresh from the store server-side, so an admin's approval/role changes take
// effect on the user's next request (no need to wait for re-login).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = 'aria_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

export type SessionPayload = { uid: number; exp: number };

export function getAuthSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.UPLOAD_SECRET ||
    'aria-siss-dev-insecure-secret-change-me'
  );
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Cast helper: structurally a Uint8Array is a valid BufferSource, but TS's
// generic Uint8Array<ArrayBufferLike> doesn't narrow to it automatically.
const src = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    src(enc.encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(
  payload: SessionPayload,
  secret: string = getAuthSecret(),
): Promise<string> {
  const body = toB64Url(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, src(enc.encode(body))));
  return body + '.' + toB64Url(sig);
}

export async function verifySession(
  token: string,
  secret: string = getAuthSecret(),
): Promise<SessionPayload | null> {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await importKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, src(fromB64Url(sig)), src(enc.encode(body)));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64Url(body))) as SessionPayload;
    if (!payload || typeof payload.uid !== 'number' || typeof payload.exp !== 'number') {
      return null;
    }
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSessionToken(uid: number): Promise<string> {
  return signSession({ uid, exp: Date.now() + SESSION_MAX_AGE * 1000 });
}
