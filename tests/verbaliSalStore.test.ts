import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/schema';
import { persistVerbaliSalFromUpload, listAllVerbaliSal, listSalByBdo } from '@/lib/verbaliSalStore';
import { persistVerbaliAperturaFromUpload, listAllVerbaliApertura } from '@/lib/verbaliAperturaStore';
import type { VerbaleAperturaRecord, VerbaleSalRecord } from '@/lib/types';

// The stores talk to Neon through the neon-http driver. These tests swap it for
// an in-process Postgres (PGlite) so the real SQL — DELETE/INSERT/ON CONFLICT —
// runs, including Postgres' bind-parameter limit. `batch` is emulated with a
// real BEGIN/COMMIT, mirroring the all-or-nothing semantics of Neon's batch.
const state = vi.hoisted(() => ({ hasDB: true, db: null as unknown }));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    get hasDB() {
      return state.hasDB;
    },
    getDb: () => state.db,
    ensureSchema: async () => {},
  };
});

const SAL_DDL = `CREATE TABLE verbali_sal (
  id serial PRIMARY KEY, num_bdo text, descrizione text, nome_file text, codifica_documento text,
  stato_verbale text, periodo_competenza text, conforme text, motivo_conformita text, criticita text,
  motivazione_criticita text, livelli_servizio_rispettati text, divisione text, centro_costo text,
  fornitore text, utente_caricamento_fornitore text, data_firma_fornitore date, roi text,
  data_inserimento_verbale_non_sottomesso date, data_sottomissione_verbale_fornitore date,
  data_firma_roi date, data_rifiuto_roi date, data_invio_roi date, updated_at timestamp DEFAULT now())`;

const APERTURA_DDL = `CREATE TABLE verbali_apertura (
  id serial PRIMARY KEY, num_bdo text, descrizione text, nome_file text, codifica_documento text,
  stato_verbale text, periodo_competenza text, divisione text, centro_costo text, fornitore text,
  utente_caricamento_fornitore text, data_firma_fornitore date, roi text,
  data_inserimento_verbale_non_sottomesso date, data_sottomissione_verbale_fornitore date,
  data_firma_roi date, data_rifiuto_roi date, data_invio_roi date, updated_at timestamp DEFAULT now());
CREATE UNIQUE INDEX verbali_apertura_num_bdo_codifica_unique ON verbali_apertura (num_bdo, codifica_documento)`;

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SAL_DDL);
  await pg.exec(APERTURA_DDL);
  const db = drizzle(pg, { schema });
  state.db = Object.assign(db, {
    batch: async (stmts: PromiseLike<unknown>[]) => {
      await pg.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const s of stmts) out.push(await s);
        await pg.exec('COMMIT');
        return out;
      } catch (e) {
        await pg.exec('ROLLBACK');
        throw e;
      }
    },
  });
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  state.hasDB = true;
  await pg.exec('TRUNCATE verbali_sal, verbali_apertura RESTART IDENTITY');
  const g = globalThis as Record<string, unknown>;
  delete g.__ARIA_VERBALI_SAL__;
  delete g.__ARIA_VERBALI_APERTURA__;
});

const count = async (table: string): Promise<number> =>
  ((await pg.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n);

const sal = (o: Partial<VerbaleSalRecord> = {}): VerbaleSalRecord => ({
  num_bdo: 'BDO1',
  descrizione: 'Verbale SAL',
  nome_file: 'sal_gennaio.pdf',
  codifica_documento: 'C-001',
  stato_verbale: 'Firmato',
  periodo_competenza: '2026-01',
  conforme: 'SI',
  motivo_conformita: null,
  criticita: null,
  motivazione_criticita: null,
  livelli_servizio_rispettati: 'SI',
  divisione: 'DIV',
  centro_costo: 'CC1',
  fornitore: 'Intellera',
  utente_caricamento_fornitore: 'utente',
  data_firma_fornitore: '2026-02-01',
  roi: 'roi',
  data_inserimento_verbale_non_sottomesso: null,
  data_sottomissione_verbale_fornitore: '2026-02-02',
  data_firma_roi: '2026-02-03',
  data_rifiuto_roi: null,
  data_invio_roi: '2026-02-02',
  ...o,
});

const apertura = (o: Partial<VerbaleAperturaRecord> = {}): VerbaleAperturaRecord => ({
  num_bdo: 'BDO1',
  descrizione: 'Verbale apertura',
  nome_file: 'apertura.pdf',
  codifica_documento: 'A-001',
  stato_verbale: 'Firmato',
  periodo_competenza: '2026-01',
  divisione: 'DIV',
  centro_costo: 'CC1',
  fornitore: 'Intellera',
  utente_caricamento_fornitore: 'utente',
  data_firma_fornitore: '2026-02-01',
  roi: 'roi',
  data_inserimento_verbale_non_sottomesso: null,
  data_sottomissione_verbale_fornitore: '2026-02-02',
  data_firma_roi: '2026-02-03',
  data_rifiuto_roi: null,
  data_invio_roi: '2026-02-02',
  ...o,
});

const monthly = (bdo: string, n: number): VerbaleSalRecord[] =>
  Array.from({ length: n }, (_, i) =>
    sal({ num_bdo: bdo, codifica_documento: `C-${bdo}-${i}`, periodo_competenza: `P-${i}`, nome_file: `sal_${i}.pdf` }),
  );

describe('verbali_sal — database mode', () => {
  it('stores every row of the first upload', async () => {
    const res = await persistVerbaliSalFromUpload(monthly('BDO1', 5));
    expect(res.saved).toBe(5);
    expect(await count('verbali_sal')).toBe(5);
  });

  it('REGRESSION: re-uploading the same file does not duplicate rows', async () => {
    const file = monthly('BDO1', 4);
    await persistVerbaliSalFromUpload(file);
    await persistVerbaliSalFromUpload(file);
    await persistVerbaliSalFromUpload(file);
    expect(await count('verbali_sal')).toBe(4);
  });

  it('keeps previously stored periods when a later file brings new ones (append is preserved)', async () => {
    await persistVerbaliSalFromUpload(monthly('BDO1', 3));
    await persistVerbaliSalFromUpload(monthly('BDO1', 5));
    expect(await count('verbali_sal')).toBe(5);
    const periods = (await listSalByBdo('BDO1')).map((r) => r.periodo_competenza).sort();
    expect(periods).toEqual(['P-0', 'P-1', 'P-2', 'P-3', 'P-4']);
  });

  it('never overwrites or deletes a stored row whose content differs', async () => {
    await persistVerbaliSalFromUpload([sal({ stato_verbale: 'Bozza' })]);
    await persistVerbaliSalFromUpload([sal({ stato_verbale: 'Firmato' })]);
    const stati = (await listSalByBdo('BDO1')).map((r) => r.stato_verbale).sort();
    expect(stati).toEqual(['Bozza', 'Firmato']);
  });

  it('keeps identical rows that appear several times inside one upload (multiset semantics)', async () => {
    const a = sal();
    await persistVerbaliSalFromUpload([a, a]);
    expect(await count('verbali_sal')).toBe(2);
    await persistVerbaliSalFromUpload([a, a]);
    expect(await count('verbali_sal')).toBe(2);
    await persistVerbaliSalFromUpload([a, a, a]);
    expect(await count('verbali_sal')).toBe(3);
  });

  it('scopes the comparison to the BDO: other BDOs are untouched and independent', async () => {
    await persistVerbaliSalFromUpload([...monthly('BDO1', 2), ...monthly('BDO2', 3)]);
    await persistVerbaliSalFromUpload(monthly('BDO1', 2));
    expect(await count('verbali_sal')).toBe(5);
    expect(await listSalByBdo('BDO1')).toHaveLength(2);
    expect(await listSalByBdo('BDO2')).toHaveLength(3);
  });

  it('is a no-op for an empty upload and leaves stored rows alone', async () => {
    await persistVerbaliSalFromUpload(monthly('BDO1', 2));
    const res = await persistVerbaliSalFromUpload([]);
    expect(res.saved).toBe(0);
    expect(await count('verbali_sal')).toBe(2);
  });

  it('round-trips a record unchanged (no id / updated_at leaking, nulls and dates intact)', async () => {
    const rec = sal({ motivo_conformita: 'nota', data_rifiuto_roi: '2026-03-10' });
    await persistVerbaliSalFromUpload([rec]);
    expect(await listAllVerbaliSal()).toEqual([rec]);
  });

  it('handles uploads larger than the Postgres bind-parameter limit and stays idempotent', async () => {
    // ~23 bound columns per row: 3000 rows is ~69k parameters in a single INSERT,
    // above the 65,535 limit, so the insert must be split into chunks.
    const big = monthly('BDO1', 3000);
    await persistVerbaliSalFromUpload(big);
    expect(await count('verbali_sal')).toBe(3000);
    await persistVerbaliSalFromUpload(big);
    expect(await count('verbali_sal')).toBe(3000);
  }, 120_000);
});

describe('verbali_sal — in-memory mode (regression)', () => {
  beforeEach(() => {
    state.hasDB = false;
  });

  it('re-uploading the same file does not duplicate rows', async () => {
    const file = monthly('BDO1', 3);
    await persistVerbaliSalFromUpload(file);
    await persistVerbaliSalFromUpload(file);
    expect(await listAllVerbaliSal()).toHaveLength(3);
  });

  it('leaves other BDOs untouched', async () => {
    await persistVerbaliSalFromUpload([...monthly('BDO1', 2), ...monthly('BDO2', 2)]);
    await persistVerbaliSalFromUpload(monthly('BDO1', 2));
    expect(await listSalByBdo('BDO2')).toHaveLength(2);
    expect(await listAllVerbaliSal()).toHaveLength(4);
  });
});

describe('verbali_apertura — keyed upsert path (regression: must be unaffected)', () => {
  it('re-uploading the same file keeps one row per natural key', async () => {
    const file = [apertura({ codifica_documento: 'A-1' }), apertura({ codifica_documento: 'A-2' })];
    await persistVerbaliAperturaFromUpload(file);
    await persistVerbaliAperturaFromUpload(file);
    expect(await count('verbali_apertura')).toBe(2);
  });

  it('updates a row in place when the same key arrives with new content', async () => {
    await persistVerbaliAperturaFromUpload([apertura({ stato_verbale: 'Bozza' })]);
    await persistVerbaliAperturaFromUpload([apertura({ stato_verbale: 'Firmato' })]);
    const rows = await listAllVerbaliApertura();
    expect(rows).toHaveLength(1);
    expect(rows[0].stato_verbale).toBe('Firmato');
  });

  it('drops rows of the same BDO that are no longer in the upload, keeps other BDOs', async () => {
    await persistVerbaliAperturaFromUpload([
      apertura({ codifica_documento: 'A-1' }),
      apertura({ codifica_documento: 'A-2' }),
      apertura({ num_bdo: 'BDO2', codifica_documento: 'A-9' }),
    ]);
    await persistVerbaliAperturaFromUpload([apertura({ codifica_documento: 'A-1' })]);
    const keys = (await listAllVerbaliApertura()).map((r) => `${r.num_bdo}/${r.codifica_documento}`).sort();
    expect(keys).toEqual(['BDO1/A-1', 'BDO2/A-9']);
  });
});

describe('documented cleanup of pre-existing duplicates', () => {
  it('the SQL published in docs/improvement-plan.md removes only exact duplicates', async () => {
    const md = readFileSync(fileURLToPath(new URL('../docs/improvement-plan.md', import.meta.url)), 'utf8');
    const m = md.match(/<!-- sal-dedup-sql -->\s*```sql\n([\s\S]*?)```/);
    expect(m, 'cleanup SQL block not found in docs').not.toBeNull();

    // Simulate rows duplicated by the pre-fix behaviour, straight into the table.
    const dupe = sal({ codifica_documento: 'C-DUP' });
    const nulls = sal({ codifica_documento: null, nome_file: null });
    await persistVerbaliSalFromUpload([dupe, nulls, sal({ codifica_documento: 'C-OTHER' })]);
    for (const r of [dupe, dupe, nulls]) {
      const cols = Object.keys(r) as (keyof VerbaliSalRow)[];
      await pg.query(
        `insert into verbali_sal (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
        cols.map((c) => r[c]),
      );
    }
    expect(await count('verbali_sal')).toBe(6);

    await pg.exec(m![1]);

    expect(await count('verbali_sal')).toBe(3);
    const codes = (await listAllVerbaliSal()).map((r) => r.codifica_documento).sort();
    expect(codes).toEqual(['C-DUP', 'C-OTHER', null].sort());
  });
});

type VerbaliSalRow = VerbaleSalRecord;
