import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { getDb, hasDB, ensureSchema, excludedSet } from './db';

type BatchItem = RunnableQuery<unknown, 'pg'>;

// Shared implementation behind befStore/reportPdcStore/verbaliAperturaStore/
// verbaliSalStore-style tables: a DB-backed snapshot of an Excel export, with
// an in-memory fallback when no DB is configured (see lib/store.ts).
//
// Two replacement strategies, selected by whether `extraKeyColumns` is set:
//  - Natural-key upsert (report_pdc, verbali_apertura): rows are identified
//    by (scopeColumn, ...extraKeyColumns) — see the unique indexes in
//    lib/schema.ts. Rows missing any extra key column aren't deduplicable
//    and are always fully replaced for their scope value instead of being
//    matched by key (mirrors the pre-R-5 per-table implementations).
//  - Append-only (verbali_sal): no natural key at all, every upload is a
//    plain insert — multiple rows per scope value are expected and never
//    deduplicated (e.g. periodic SAL reports).
export type SnapshotStoreConfig<TTable extends PgTable, TRecord extends Record<string, unknown>> = {
  table: TTable;
  // globalThis property name for the in-memory fallback array (mirrors the
  // pre-existing `__ARIA_XXX__` convention).
  memGlobalKey: string;
  // Column that scopes a single upload batch: every existing row whose value
  // is in the incoming batch is a candidate for replacement (e.g. num_bdo).
  scopeColumn: PgColumn;
  getScopeValue: (r: TRecord) => string | null;
  // Additional columns beyond scopeColumn that complete the natural key.
  // Omit for append-only tables (no natural key — see verbali_sal above).
  extraKeyColumns?: PgColumn[];
  getExtraKeyValues?: (r: TRecord) => (string | null)[];
  // Record fields stored as SQL `numeric` (Postgres/Drizzle round-trips
  // these as strings) but represented as `number | null` in the record type
  // — converted automatically by the default toRow/fromRow below.
  numericColumns?: string[];
  // Both default to a passthrough (every stored column is already a record
  // field: add `updated_at` going in, drop `id`/`updated_at` coming out,
  // convert `numericColumns` both ways) — enough for every current table.
  // Supply your own for anything more specific (e.g. a non-numeric
  // conversion, or a fallback for a column that's nullable in the DB but not
  // in the record type).
  toRow?: (r: TRecord) => TTable['$inferInsert'];
  fromRow?: (row: TTable['$inferSelect']) => TRecord;
};

function buildDefaultToRow(numericColumns: string[]) {
  return (r: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...r, updated_at: new Date() };
    for (const c of numericColumns) row[c] = r[c] == null ? null : String(r[c]);
    return row;
  };
}

function buildDefaultFromRow(numericColumns: string[]) {
  return (row: Record<string, unknown>) => {
    const { id: _id, updated_at: _updatedAt, ...rest } = row;
    for (const c of numericColumns) rest[c] = rest[c] == null ? null : Number(rest[c]);
    return rest;
  };
}

export function createSnapshotStore<TTable extends PgTable, TRecord extends Record<string, unknown>>(
  config: SnapshotStoreConfig<TTable, TRecord>,
) {
  const numericColumns = config.numericColumns ?? [];
  const {
    table,
    memGlobalKey,
    scopeColumn,
    getScopeValue,
    extraKeyColumns,
    getExtraKeyValues,
    toRow = buildDefaultToRow(numericColumns) as (r: TRecord) => TTable['$inferInsert'],
    fromRow = buildDefaultFromRow(numericColumns) as (row: TTable['$inferSelect']) => TRecord,
  } = config;

  function mem(): TRecord[] {
    const g = globalThis as unknown as Record<string, TRecord[] | undefined>;
    if (!g[memGlobalKey]) g[memGlobalKey] = [];
    return g[memGlobalKey]!;
  }

  async function persistFromUpload(rows: TRecord[]): Promise<{ saved: number }> {
    if (!rows.length) return { saved: 0 };
    const scopeList = [...new Set(rows.map(getScopeValue).filter((v): v is string => !!v))];

    if (hasDB) {
      await ensureSchema();
      const db = getDb();

      if (!extraKeyColumns || !extraKeyColumns.length) {
        // Append-only: no natural key beyond the scope column.
        await db.insert(table).values(rows.map(toRow) as (typeof table)['$inferInsert'][]);
        return { saved: rows.length };
      }

      const getExtra = getExtraKeyValues!;
      const isKeyed = (r: TRecord) => getExtra(r).every((v) => v != null && v !== '');
      const keyed = rows.filter(isKeyed);
      const unkeyed = rows.filter((r) => !isKeyed(r));

      const statements: BatchItem[] = [];
      if (scopeList.length) {
        const keyCols = [scopeColumn, ...extraKeyColumns];
        const keyExpr = sql`(${sql.join(
          keyCols.map((c) => sql`${c}`),
          sql`, `,
        )})`;
        const keyedTuples = keyed.map(
          (r) =>
            sql`(${sql.join(
              [getScopeValue(r), ...getExtra(r)].map((v) => sql`${v}`),
              sql`, `,
            )})`,
        );
        // Drop keyed rows whose natural-key tuple is no longer in the new
        // set for this scope — removed/superseded in this upload.
        statements.push(
          db.delete(table).where(
            keyedTuples.length
              ? and(
                  inArray(scopeColumn, scopeList),
                  ...extraKeyColumns.map((c) => isNotNull(c)),
                  sql`${keyExpr} NOT IN (${sql.join(keyedTuples, sql`, `)})`,
                )
              : and(inArray(scopeColumn, scopeList), ...extraKeyColumns.map((c) => isNotNull(c))),
          ),
        );
        // Unkeyed rows have no stable identity, so this upload's list is
        // always their full replacement for the scopes it touches.
        statements.push(
          db.delete(table).where(and(inArray(scopeColumn, scopeList), or(...extraKeyColumns.map((c) => isNull(c))))),
        );
      }
      if (unkeyed.length) statements.push(db.insert(table).values(unkeyed.map(toRow) as (typeof table)['$inferInsert'][]));
      if (keyed.length) {
        statements.push(
          db
            .insert(table)
            .values(keyed.map(toRow) as (typeof table)['$inferInsert'][])
            .onConflictDoUpdate({
              target: [scopeColumn, ...extraKeyColumns],
              set: excludedSet(table, ['id', scopeColumn.name, ...extraKeyColumns.map((c) => c.name)]),
            }),
        );
      }
      if (statements.length) {
        // db.batch() sends every statement to Neon's transactional batch
        // endpoint in a single HTTP round-trip: either all apply or none do.
        // neon-http has no interactive db.transaction() (see
        // drizzle-orm/neon-http/session.js).
        await db.batch(statements as [BatchItem, ...BatchItem[]]);
      }
      return { saved: rows.length };
    }

    const kept = mem().filter((r) => {
      const v = getScopeValue(r);
      return !v || !scopeList.includes(v);
    });
    kept.push(...rows);
    (globalThis as unknown as Record<string, TRecord[]>)[memGlobalKey] = kept;
    return { saved: rows.length };
  }

  async function listByScope(scopeValue: string): Promise<TRecord[]> {
    if (!scopeValue) return [];
    if (hasDB) {
      await ensureSchema();
      const rows = await getDb().select().from(table).where(eq(scopeColumn, scopeValue));
      return (rows as (typeof table)['$inferSelect'][]).map(fromRow);
    }
    return mem().filter((r) => getScopeValue(r) === scopeValue);
  }

  // Every row of the table, unscoped — used by the full-database export so the
  // downloaded workbook contains the actual data in both DB and in-memory modes.
  async function listAll(): Promise<TRecord[]> {
    if (hasDB) {
      await ensureSchema();
      const rows = await getDb().select().from(table);
      return (rows as (typeof table)['$inferSelect'][]).map(fromRow);
    }
    return mem().map((r) => ({ ...r }));
  }

  return { persistFromUpload, listByScope, listAll };
}
