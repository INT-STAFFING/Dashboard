import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as middlewareConfig } from '@/middleware';
import { GET as swRoute } from '@/app/sw.js/route';

const path = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const manifest = JSON.parse(readFileSync(path('public/manifest.webmanifest'), 'utf8'));

describe('PWA manifest', () => {
  it('is standalone, scoped to the site root and starts on the dashboard', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.lang).toBe('it');
  });

  it('declares 192/512 any icons and a 512 maskable icon that exist on disk', () => {
    const find = (sizes: string, purpose: string) =>
      manifest.icons.find((i: { sizes: string; purpose: string }) => i.sizes === sizes && i.purpose === purpose);
    expect(find('192x192', 'any')).toBeDefined();
    expect(find('512x512', 'any')).toBeDefined();
    expect(find('512x512', 'maskable')).toBeDefined();
    for (const i of manifest.icons) expect(existsSync(path('public' + i.src)), i.src).toBe(true);
    expect(existsSync(path('public/apple-touch-icon.png'))).toBe(true);
    expect(existsSync(path('public/offline.html'))).toBe(true);
  });
});

describe('PWA files vs auth middleware', () => {
  const re = new RegExp('^' + middlewareConfig.matcher[0].replace(/^\//, '/'));
  it.each(['/sw.js', '/manifest.webmanifest', '/offline.html', '/icons/icon-512.png', '/apple-touch-icon.png', '/icon.svg'])(
    '%s is reachable without a session',
    (p) => expect(re.test(p)).toBe(false)
  );
  it.each(['/dashboard', '/api/data', '/upload', '/login'])('%s still goes through the middleware', (p) =>
    expect(re.test(p)).toBe(true)
  );
});

describe('service worker', () => {
  it('is served as JavaScript, never cached, and ignores non-GET requests', async () => {
    const res = swRoute();
    expect(res.headers.get('Content-Type')).toMatch(/javascript/);
    expect(res.headers.get('Cache-Control')).toMatch(/no-cache/);
    const body = await res.text();
    expect(body).toContain("req.method !== 'GET'");
    expect(body).toContain('/_next/static/');
    expect(() => new Function(body)).not.toThrow();
  });
});
