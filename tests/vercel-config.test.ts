import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

// Neon AWS region -> Vercel region closest to it. With the neon-http driver every
// query is an HTTPS round-trip, so the functions must run next to the database.
const NEON_TO_VERCEL: Record<string, string> = {
  'eu-central-1': 'fra1',
  'eu-central-2': 'zrh1',
  'eu-west-1': 'dub1',
  'eu-west-2': 'lhr1',
  'us-east-1': 'iad1',
  'us-east-2': 'cle1',
  'us-west-2': 'pdx1',
  'ap-southeast-1': 'sin1',
  'ap-southeast-2': 'syd1',
  'sa-east-1': 'gru1',
};

const vercel = JSON.parse(read('vercel.json')) as { framework?: string; regions?: string[] };

describe('vercel.json', () => {
  it('keeps the Next.js framework preset (regression)', () => {
    expect(vercel.framework).toBe('nextjs');
  });

  it('pins functions to exactly one region', () => {
    expect(Array.isArray(vercel.regions)).toBe(true);
    expect(vercel.regions).toHaveLength(1);
    expect(vercel.regions![0]).toMatch(/^[a-z]{3}\d$/);
  });

  it('uses the Vercel region matching the Neon region documented in .env.example', () => {
    const m = read('.env.example').match(/ep-[\w-]+\.([a-z]{2}-[a-z]+-\d)\.aws\.neon\.tech/);
    expect(m, 'no Neon endpoint example found in .env.example').not.toBeNull();
    const expected = NEON_TO_VERCEL[m![1]];
    expect(expected, `unmapped Neon region ${m![1]}`).toBeDefined();
    expect(vercel.regions).toEqual([expected]);
  });
});
