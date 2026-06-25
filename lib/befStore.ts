import { eq } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from './db';
import { bef_records } from './schema';
import type { BefRow } from './types';

// Per-IF/BO BEF rows. DB-backed with an in-memory fallback.
const g = globalThis as unknown as { __ARIA_BEF__?: Record<string, BefRow[]> };
function mem(): Record<string, BefRow[]> {
  if (!g.__ARIA_BEF__) g.__ARIA_BEF__ = {};
  return g.__ARIA_BEF__;
}

const numN = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const strN = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

type Row = typeof bef_records.$inferSelect;
function rowTo(r: Row): BefRow {
  return {
    id: r.id,
    numero_if: r.numero_if ?? '',
    num_bdo: r.num_bdo,
    descrizione: r.descrizione,
    periodo_competenza: r.periodo_competenza,
    fornitore_reale: r.fornitore_reale,
    importo_ricezione: r.importo_ricezione == null ? null : Number(r.importo_ricezione),
    num_fattura: r.num_fattura,
    data_fattura: r.data_fattura,
    data_pagamento: r.data_pagamento,
  };
}

export async function listBef(numeroIf: string): Promise<BefRow[]> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(bef_records).where(eq(bef_records.numero_if, numeroIf));
    return rows.map(rowTo);
  }
  return (mem()[numeroIf] || []).map((r) => ({ ...r }));
}

// Replace the full set of BEF rows for an intervento (idempotent save).
export async function replaceBef(numeroIf: string, rows: BefRow[]): Promise<BefRow[]> {
  const clean = rows.map((r) => ({
    numero_if: numeroIf,
    num_bdo: strN(r.num_bdo),
    descrizione: strN(r.descrizione),
    periodo_competenza: strN(r.periodo_competenza),
    fornitore_reale: strN(r.fornitore_reale),
    importo_ricezione: numN(r.importo_ricezione),
    num_fattura: strN(r.num_fattura),
    data_fattura: strN(r.data_fattura),
    data_pagamento: strN(r.data_pagamento),
  }));

  if (hasDB) {
    await ensureSchema();
    await getDb().delete(bef_records).where(eq(bef_records.numero_if, numeroIf));
    if (clean.length) {
      await getDb().insert(bef_records).values(
        clean.map((r) => ({
          numero_if: r.numero_if,
          num_bdo: r.num_bdo,
          descrizione: r.descrizione,
          periodo_competenza: r.periodo_competenza,
          fornitore_reale: r.fornitore_reale,
          importo_ricezione: r.importo_ricezione == null ? null : String(r.importo_ricezione),
          num_fattura: r.num_fattura,
          data_fattura: r.data_fattura,
          data_pagamento: r.data_pagamento,
        })),
      );
    }
    return listBef(numeroIf);
  }
  mem()[numeroIf] = clean.map((r, i) => ({ id: i + 1, ...r }));
  return mem()[numeroIf].map((r) => ({ ...r }));
}
