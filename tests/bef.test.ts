import { beforeEach, describe, expect, it } from 'vitest';
import { computeBefAggregates, computeBefMonthlyTotals, listAllBef, listBef, persistBefFromUpload, replaceBef } from '@/lib/befStore';
import { bdoFromBef, isBdoCode, isBefCode, isIfCode } from '@/lib/codes';
import type { BefRecord, BefRow } from '@/lib/types';

const row = (o: Partial<BefRow>): BefRow =>
  ({
    numero_if: 'IF1',
    num_bdo: null,
    descrizione: null,
    numero_linea_ordine: null,
    periodo_competenza: null,
    fornitore_reale: 'Intellera',
    importo_ricezione: 0,
    num_fattura: null,
    data_fattura: null,
    data_pagamento: null,
    ...o,
  }) as BefRow;

describe('computeBefAggregates — lifecycle of a BEF row', () => {
  it('splits rows into fatturabile / in attesa / emesso, with incassato a subset of emesso', () => {
    const a = computeBefAggregates([
      row({ importo_ricezione: 100 }), // no invoice -> da emettere
      row({ importo_ricezione: 50, data_fattura: '2026-03-01' }), // a date without a number is NOT an issued invoice
      row({ importo_ricezione: 200, num_fattura: 'F1' }), // number, no date -> in attesa
      row({ importo_ricezione: 300, num_fattura: 'F2', data_fattura: '2026-03-10' }), // emessa
      row({ importo_ricezione: 400, num_fattura: 'F3', data_fattura: '2026-03-12', data_pagamento: '2026-04-01' }), // emessa + incassata
    ]);
    expect(a).toEqual({ fatturabile: 150, fatturatoInAttesa: 200, fatturatoEmesso: 700, fatturatoIncassato: 400 });
  });

  it('fatturabile + in attesa + emesso equals the BEF total; incassato is not added again', () => {
    const rows = [
      row({ importo_ricezione: 10 }),
      row({ importo_ricezione: 20, num_fattura: 'A' }),
      row({ importo_ricezione: 30, num_fattura: 'B', data_fattura: '2026-01-01' }),
      row({ importo_ricezione: 40, num_fattura: 'C', data_fattura: '2026-01-01', data_pagamento: '2026-02-01' }),
    ];
    const a = computeBefAggregates(rows);
    expect(a.fatturabile + a.fatturatoInAttesa + a.fatturatoEmesso).toBe(100);
    expect(a.fatturatoIncassato).toBeLessThanOrEqual(a.fatturatoEmesso);
  });

  it('skips rows with no amount and handles an empty list', () => {
    expect(computeBefAggregates([row({ importo_ricezione: null })])).toEqual({ fatturabile: 0, fatturatoInAttesa: 0, fatturatoEmesso: 0, fatturatoIncassato: 0 });
    expect(computeBefAggregates([])).toEqual({ fatturabile: 0, fatturatoInAttesa: 0, fatturatoEmesso: 0, fatturatoIncassato: 0 });
  });

  it('REGRESSION: several rows sharing one invoice number all count (the old unique index collapsed them)', () => {
    const a = computeBefAggregates([
      row({ importo_ricezione: 100, num_fattura: 'SAME', data_fattura: '2026-05-02' }),
      row({ importo_ricezione: 250, num_fattura: 'SAME', data_fattura: '2026-05-02' }),
      row({ importo_ricezione: 75, num_fattura: 'SAME', data_fattura: '2026-05-02' }),
    ]);
    expect(a.fatturatoEmesso).toBe(425);
  });
});

describe('computeBefMonthlyTotals', () => {
  it('groups issued invoices by the month of data_fattura', () => {
    const t = computeBefMonthlyTotals([
      row({ importo_ricezione: 100, num_fattura: 'A', data_fattura: '2026-03-05' }),
      row({ importo_ricezione: 40, num_fattura: 'B', data_fattura: '2026-03-28' }),
      row({ importo_ricezione: 7, num_fattura: 'C', data_fattura: '2026-04-01' }),
    ]);
    expect(t).toHaveLength(2);
    expect(t).toContainEqual({ anno: 2026, mese: 3, totale: 140 });
    expect(t).toContainEqual({ anno: 2026, mese: 4, totale: 7 });
  });

  it('REGRESSION: only issued invoices have a month — billable and pending rows are left out', () => {
    expect(
      computeBefMonthlyTotals([
        row({ importo_ricezione: 5, data_fattura: '2026-03-05' }), // date, no number
        row({ importo_ricezione: 6, num_fattura: 'X' }), // number, no date
        row({ importo_ricezione: 7 }),
      ]),
    ).toEqual([]);
  });

  it('skips rows with no amount or an unusable date', () => {
    expect(
      computeBefMonthlyTotals([
        row({ importo_ricezione: null, num_fattura: 'A', data_fattura: '2026-03-05' }),
        row({ importo_ricezione: 10, num_fattura: 'B', data_fattura: '0000-00-00' }),
      ]),
    ).toEqual([]);
  });
});

describe('persistBefFromUpload / replaceBef — in-memory snapshot semantics', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__ARIA_BEF__;
  });

  const rec = (o: Partial<BefRecord>): BefRecord =>
    ({
      num_bdo: null,
      descrizione: null,
      numero_linea_ordine: null,
      periodo_competenza: null,
      fornitore_reale: 'Intellera',
      importo_ricezione: 0,
      num_fattura: null,
      data_fattura: null,
      data_pagamento: null,
      ...o,
    }) as BefRecord;

  const bdoToIf = new Map([
    ['3300000001', 'IF1'],
    ['3300000002', 'IF2'],
  ]);

  it('routes each row to the IF that owns its BDO', async () => {
    const res = await persistBefFromUpload([rec({ num_bdo: '3300000001', importo_ricezione: 10 }), rec({ num_bdo: '3300000002', importo_ricezione: 20 })], bdoToIf);
    expect(res).toEqual({ saved: 2, ifs: ['IF1', 'IF2'], unresolved: 0 });
    expect((await listBef('IF1'))[0].importo_ricezione).toBe(10);
    expect((await listBef('IF2'))[0].importo_ricezione).toBe(20);
  });

  it('falls back to the BDO embedded in the 20-digit BEF code when the BDO column is missing', async () => {
    const bef = '26049999999999123456'; // AA MM BBBBBBBBBB XXXXXX -> BDO 9999999999
    expect(bdoFromBef(bef)).toBe('9999999999');
    const res = await persistBefFromUpload([rec({ num_fattura: bef, importo_ricezione: 5 })], new Map([['9999999999', 'IF9']]));
    expect(res.ifs).toEqual(['IF9']);
  });

  it('keeps rows whose BDO is unknown (nothing is dropped) and counts them as unresolved', async () => {
    const res = await persistBefFromUpload([rec({ num_bdo: '3300009999', importo_ricezione: 8 })], bdoToIf);
    expect(res).toEqual({ saved: 1, ifs: [], unresolved: 1 });
    expect(await listAllBef()).toHaveLength(1);
  });

  it('REGRESSION: a new snapshot REPLACES the IF\'s rows (no doubling on re-import), other IFs stay untouched', async () => {
    await persistBefFromUpload(
      [rec({ num_bdo: '3300000001', importo_ricezione: 100 }), rec({ num_bdo: '3300000001', importo_ricezione: 50 }), rec({ num_bdo: '3300000002', importo_ricezione: 7 })],
      bdoToIf,
    );
    // The invoice was issued in the meantime: the same line now carries a number.
    await persistBefFromUpload([rec({ num_bdo: '3300000001', importo_ricezione: 100, num_fattura: 'F1', data_fattura: '2026-03-01' })], bdoToIf);
    const if1 = await listBef('IF1');
    expect(if1).toHaveLength(1);
    expect(if1[0].num_fattura).toBe('F1');
    expect(await listBef('IF2')).toHaveLength(1);
    const total = (await listAllBef()).reduce((s, r) => s + (r.importo_ricezione ?? 0), 0);
    expect(total).toBe(107);
  });

  it('replaceBef saves exactly the rows given and normalises blanks to null', async () => {
    const saved = await replaceBef('IF1', [row({ importo_ricezione: 12.5, descrizione: '', num_fattura: '' })]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ numero_if: 'IF1', importo_ricezione: 12.5, descrizione: null, num_fattura: null });
    expect(await replaceBef('IF1', [])).toEqual([]);
  });
});

describe('ARIA code rules', () => {
  it('recognises IF (8 digits), BDO (AAAA33XXXX) and BEF (20 digits) codes', () => {
    expect(isIfCode('20260001')).toBe(true);
    expect(isIfCode('2026001')).toBe(false);
    expect(isBdoCode('2026330001')).toBe(true);
    expect(isBdoCode('2026440001')).toBe(false);
    expect(isBefCode('26049999999999123456')).toBe(true);
    expect(isBefCode('2604999999999912345')).toBe(false);
  });
  it('ignores non-digit decoration and extracts the BDO only from a full BEF code', () => {
    expect(isIfCode(' 2026-0001 ')).toBe(true);
    expect(bdoFromBef('2604-9999999999-123456')).toBe('9999999999');
    expect(bdoFromBef('123')).toBeNull();
    expect(bdoFromBef(null)).toBeNull();
  });
});
