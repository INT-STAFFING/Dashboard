import { and, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { getDb, hasDB, ensureSchema, excludedSet } from './db';
import { verbali_apertura } from './schema';
import type { VerbaleAperturaRecord } from './types';

// Snapshot of the "REPORT Apertura" export. Natural key (num_bdo,
// codifica_documento) — see the unique index in lib/schema.ts. Rows missing
// codifica_documento aren't deduplicable and are always fully replaced for
// their num_bdo instead of being matched by key. DB-backed with an in-memory
// fallback.
type AperturaBatchItem = RunnableQuery<unknown, 'pg'>;
const g = globalThis as unknown as { __ARIA_VERBALI_APERTURA__?: VerbaleAperturaRecord[] };
function mem(): VerbaleAperturaRecord[] {
  if (!g.__ARIA_VERBALI_APERTURA__) g.__ARIA_VERBALI_APERTURA__ = [];
  return g.__ARIA_VERBALI_APERTURA__;
}

function toRow(r: VerbaleAperturaRecord): typeof verbali_apertura.$inferInsert {
  return { ...r, updated_at: new Date() };
}

export async function persistVerbaliAperturaFromUpload(
  rows: VerbaleAperturaRecord[],
): Promise<{ saved: number }> {
  if (!rows.length) return { saved: 0 };
  const bdoList = [...new Set(rows.map((r) => r.num_bdo).filter((v): v is string => !!v))];

  if (hasDB) {
    await ensureSchema();
    const db = getDb();

    const isKeyed = (r: VerbaleAperturaRecord) => r.codifica_documento != null && r.codifica_documento !== '';
    const keyed = rows.filter(isKeyed);
    const unkeyed = rows.filter((r) => !isKeyed(r));

    const statements: AperturaBatchItem[] = [];
    if (bdoList.length) {
      // Drop keyed rows whose (num_bdo, codifica_documento) pair is no
      // longer in the new set for that BDO — removed/superseded in this
      // upload.
      const keyedPairs = keyed.map((r) => sql`(${r.num_bdo}, ${r.codifica_documento})`);
      statements.push(
        db
          .delete(verbali_apertura)
          .where(
            keyedPairs.length
              ? and(
                  inArray(verbali_apertura.num_bdo, bdoList),
                  isNotNull(verbali_apertura.codifica_documento),
                  sql`(${verbali_apertura.num_bdo}, ${verbali_apertura.codifica_documento}) NOT IN (${sql.join(keyedPairs, sql`, `)})`,
                )
              : and(inArray(verbali_apertura.num_bdo, bdoList), isNotNull(verbali_apertura.codifica_documento)),
          ),
      );
      // Unkeyed rows have no stable identity, so this upload's list is
      // always their full replacement for the BDOs it touches.
      statements.push(
        db
          .delete(verbali_apertura)
          .where(and(inArray(verbali_apertura.num_bdo, bdoList), or(isNull(verbali_apertura.codifica_documento), sql`${verbali_apertura.codifica_documento} = ''`))),
      );
    }
    if (unkeyed.length) statements.push(db.insert(verbali_apertura).values(unkeyed.map(toRow)));
    if (keyed.length) {
      statements.push(
        db
          .insert(verbali_apertura)
          .values(keyed.map(toRow))
          .onConflictDoUpdate({
            target: [verbali_apertura.num_bdo, verbali_apertura.codifica_documento],
            set: excludedSet(verbali_apertura, ['id', 'num_bdo', 'codifica_documento']),
          }),
      );
    }
    if (statements.length) {
      // db.batch() sends every statement to Neon's transactional batch
      // endpoint in a single HTTP round-trip: either all apply or none do.
      // neon-http has no interactive db.transaction() (see
      // drizzle-orm/neon-http/session.js).
      await db.batch(statements as [AperturaBatchItem, ...AperturaBatchItem[]]);
    }
    return { saved: rows.length };
  }

  const kept = mem().filter((r) => !r.num_bdo || !bdoList.includes(r.num_bdo));
  kept.push(...rows);
  g.__ARIA_VERBALI_APERTURA__ = kept;
  return { saved: rows.length };
}
