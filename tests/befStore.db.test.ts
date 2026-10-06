import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applySchema } from '@/lib/db';
import { computeBefAggregates, listAllBef, listBef, persistBefFromUpload, replaceBef } from '@/lib/befStore';
import type { BefRecord, BefRow } from '@/lib/types';
import { createTestDb } from './helpers/pglite';

// The BEF store against a real Postgres: this is the path production takes (the
// in-memory twin is covered in tests/bef.test.ts).
const state = vi.hoisted(() => ({ hasDB: true, db: null as unknown }));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, get hasDB() { return state.hasDB; }, getDb: () => state.db, ensureSchema: async () => {} };
});

let pg: PGlite;
beforeAll(async () => {
  const t = await createTestDb();
  pg = t.pg;
  state.db = t.db;
  await applySchema(t.db as never);
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.exec('TRUNCATE bef_records RESTART IDENTITY');
});

const row = (o: Partial<BefRow> = {}): BefRow => ({
  numero_if: 'IF1', num_bdo: '3300000001', descrizione: 'Linea', numero_linea_ordine: '1', periodo_competenza: '2026-01', fornitore_reale: 'Intellera',
  importo_ricezione: 100, num_fattura: null, data_fattura: null, data_pagamento: null, ...o,
});
const rec = (o: Partial<BefRecord> = {}): BefRecord => ({
  num_bdo: '3300000001', descrizione: 'Linea', numero_linea_ordine: '1', periodo_competenza: '2026-01', fornitore_reale: 'Intellera', importo_ricezione: 100,
  num_fattura: null, data_fattura: null, data_pagamento: null, ...o,
});
const total = async () => (await listAllBef()).reduce((s, r) => s + (r.importo_ricezione ?? 0), 0);

describe('replaceBef (database)', () => {
  it('stores the rows of an IF and reads them back with numbers as numbers', async () => {
    const saved = await replaceBef('IF1', [row({ importo_ricezione: 1234.5678, num_fattura: 'F1', data_fattura: '2026-03-05', data_pagamento: '2026-04-01' })]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ numero_if: 'IF1', importo_ricezione: 1234.5678, num_fattura: 'F1', data_fattura: '2026-03-05', data_pagamento: '2026-04-01' });
    expect(typeof saved[0].importo_ricezione).toBe('number');
  });

  it('replaces the whole set of that IF atomically and leaves the others alone', async () => {
    await replaceBef('IF1', [row(), row({ importo_ricezione: 50 })]);
    await replaceBef('IF2', [row({ numero_if: 'IF2', importo_ricezione: 7 })]);
    await replaceBef('IF1', [row({ importo_ricezione: 999 })]);
    expect((await listBef('IF1')).map((r) => r.importo_ricezione)).toEqual([999]);
    expect((await listBef('IF2')).map((r) => r.importo_ricezione)).toEqual([7]);
    expect(await replaceBef('IF1', [])).toEqual([]);
    expect(await listBef('IF1')).toEqual([]);
    expect(await listBef('IF2')).toHaveLength(1);
  });

  it('normalises blanks to null and keeps a null amount as null', async () => {
    const [r] = await replaceBef('IF1', [row({ descrizione: '', num_fattura: '', importo_ricezione: null })]);
    expect(r).toMatchObject({ descrizione: null, num_fattura: null, importo_ricezione: null });
  });

  it('REGRESSION: several rows sharing the same invoice number are all kept (no unique index collapses them)', async () => {
    await replaceBef('IF1', [
      row({ importo_ricezione: 100, num_fattura: 'SAME', data_fattura: '2026-05-02' }),
      row({ importo_ricezione: 250, num_fattura: 'SAME', data_fattura: '2026-05-02', numero_linea_ordine: '2' }),
    ]);
    expect(await listBef('IF1')).toHaveLength(2);
    expect(computeBefAggregates(await listBef('IF1')).fatturatoEmesso).toBe(350);
  });
});

describe('persistBefFromUpload (database)', () => {
  const bdoToIf = new Map([['3300000001', 'IF1'], ['3300000002', 'IF2']]);

  it('files each row under the IF that owns its BDO and keeps the unresolved ones', async () => {
    const res = await persistBefFromUpload([rec(), rec({ num_bdo: '3300000002', importo_ricezione: 20 }), rec({ num_bdo: '3300009999', importo_ricezione: 5 })], bdoToIf);
    expect(res).toEqual({ saved: 3, ifs: ['IF1', 'IF2'], unresolved: 1 });
    expect(await listBef('IF1')).toHaveLength(1);
    expect(await listBef('')).toHaveLength(1);
    expect(await listAllBef()).toHaveLength(3);
  });

  it('REGRESSION: re-importing the report never doubles the amounts, even when a line changed state', async () => {
    await persistBefFromUpload([rec({ importo_ricezione: 100 }), rec({ importo_ricezione: 50, numero_linea_ordine: '2' })], bdoToIf);
    expect(await total()).toBe(150);
    await persistBefFromUpload([rec({ importo_ricezione: 100, num_fattura: 'F1', data_fattura: '2026-03-01' }), rec({ importo_ricezione: 50, numero_linea_ordine: '2' })], bdoToIf);
    expect(await total()).toBe(150);
    expect(await listBef('IF1')).toHaveLength(2);
    expect(computeBefAggregates(await listBef('IF1'))).toMatchObject({ fatturabile: 50, fatturatoEmesso: 100 });
  });

  it('a partial report leaves the IFs it does not mention untouched', async () => {
    await persistBefFromUpload([rec(), rec({ num_bdo: '3300000002', importo_ricezione: 20 })], bdoToIf);
    await persistBefFromUpload([rec({ importo_ricezione: 1 })], bdoToIf);
    expect((await listBef('IF1')).map((r) => r.importo_ricezione)).toEqual([1]);
    expect((await listBef('IF2')).map((r) => r.importo_ricezione)).toEqual([20]);
  });

  it('falls back to the BDO embedded in the 20-digit BEF code', async () => {
    const res = await persistBefFromUpload([rec({ num_bdo: null, num_fattura: '26043300000002123456' })], bdoToIf);
    expect(res.ifs).toEqual(['IF2']);
  });
});
