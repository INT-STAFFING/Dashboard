import { describe, expect, it } from 'vitest';
import { isUploadAuthorized } from '@/lib/auth/uploadSecret';

const h = (init: Record<string, string> = {}) => new Headers(init);

describe('isUploadAuthorized', () => {
  it('REGRESSION: without UPLOAD_SECRET configured every caller passes (edit permission is the gate)', () => {
    expect(isUploadAuthorized(h(), {})).toBe(true);
    expect(isUploadAuthorized(h({ 'x-upload-secret': 'whatever' }), {})).toBe(true);
  });

  it('accepts the correct x-upload-secret header', () => {
    expect(isUploadAuthorized(h({ 'x-upload-secret': 's3cret' }), { UPLOAD_SECRET: 's3cret' })).toBe(true);
  });

  it('rejects a missing, wrong, shorter or longer header', () => {
    const env = { UPLOAD_SECRET: 's3cret' };
    expect(isUploadAuthorized(h(), env)).toBe(false);
    expect(isUploadAuthorized(h({ 'x-upload-secret': 'nope!!' }), env)).toBe(false);
    expect(isUploadAuthorized(h({ 'x-upload-secret': 's3cre' }), env)).toBe(false);
    expect(isUploadAuthorized(h({ 'x-upload-secret': 's3cret-and-more' }), env)).toBe(false);
  });
});
