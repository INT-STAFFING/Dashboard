import { eq } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from './db';
import { if_risorse } from './schema';
import type { IfRisorsa } from './types';

// Per-IF/BO resource allocation (figure professionali, gruppi di lavoro,
// giorni uomo, tariffe). DB-backed with an in-memory fallback, matching the
// rest of the store layer.
const g = globalThis as unknown as { __ARIA_RIS__?: Record<string, IfRisorsa[]> };
function mem(): Record<string, IfRisorsa[]> {
  if (!g.__ARIA_RIS__) g.__ARIA_RIS__ = {};
  return g.__ARIA_RIS__;
}

const num = (v: unknown): number | null =>
  v == null || v === '' ? null : Number(v);

type Row = typeof if_risorse.$inferSelect;
function rowTo(r: Row): IfRisorsa {
  return {
    id: r.id,
    numero_if: r.numero_if,
    figura: r.figura,
    sigla: r.sigla,
    gruppo: r.gruppo,
    gg: r.gg == null ? null : Number(r.gg),
    tariffa_giornaliera: r.tariffa_giornaliera == null ? null : Number(r.tariffa_giornaliera),
  };
}

export async function listRisorse(numeroIf: string): Promise<IfRisorsa[]> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(if_risorse).where(eq(if_risorse.numero_if, numeroIf));
    return rows.map(rowTo);
  }
  return (mem()[numeroIf] || []).map((r) => ({ ...r }));
}

// Replace the full set of resource rows for an intervento (idempotent save).
export async function replaceRisorse(
  numeroIf: string,
  rows: IfRisorsa[],
): Promise<IfRisorsa[]> {
  const clean = rows.map((r) => ({
    numero_if: numeroIf,
    figura: r.figura ?? null,
    sigla: r.sigla ?? null,
    gruppo: r.gruppo ?? null,
    gg: num(r.gg),
    tariffa_giornaliera: num(r.tariffa_giornaliera),
  }));

  if (hasDB) {
    await ensureSchema();
    await getDb().delete(if_risorse).where(eq(if_risorse.numero_if, numeroIf));
    if (clean.length) {
      await getDb().insert(if_risorse).values(
        clean.map((r) => ({
          numero_if: r.numero_if,
          figura: r.figura,
          sigla: r.sigla,
          gruppo: r.gruppo,
          gg: r.gg == null ? null : String(r.gg),
          tariffa_giornaliera: r.tariffa_giornaliera == null ? null : String(r.tariffa_giornaliera),
        })),
      );
    }
    return listRisorse(numeroIf);
  }
  mem()[numeroIf] = clean.map((r, i) => ({ id: i + 1, ...r }));
  return mem()[numeroIf].map((r) => ({ ...r }));
}
