import { timingSafeEqual } from 'node:crypto';

// The upload secret travels only in the `x-upload-secret` header. It used to be
// accepted as `?token=` too, but query strings end up in access logs, browser
// history and Referer headers.
export function isUploadAuthorized(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.UPLOAD_SECRET;
  if (!secret) return true; // no secret configured -> rely on edit permission
  const provided = headers.get('x-upload-secret') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
