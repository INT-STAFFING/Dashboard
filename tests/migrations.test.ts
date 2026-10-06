import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from '@/lib/db';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const journal = JSON.parse(readFileSync(root('drizzle/meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

describe('drizzle migrations journal', () => {
  it('has one SQL file per entry, contiguous indexes and increasing timestamps', () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(existsSync(root(`drizzle/${e.tag}.sql`)), e.tag).toBe(true);
      if (i) expect(e.when).toBeGreaterThan(journal.entries[i - 1].when);
    });
  });

  it('keeps the self-provisioning DDL in lib/db.ts in sync with the new tables', () => {
    const src = readFileSync(root('lib/db.ts'), 'utf8');
    for (const t of ['login_attempts', 'admin_audit_log']) {
      expect(src).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    }
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(8);
  });
});
