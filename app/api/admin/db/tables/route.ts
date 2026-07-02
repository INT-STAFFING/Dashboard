import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getDb, hasDB } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORBIDDEN = NextResponse.json(
  { ok: false, error: 'Riservato agli amministratori' },
  { status: 403 },
);

// GET -> elenco tabelle dello schema public con conteggio colonne e righe (approssimato)
export async function GET() {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  if (!hasDB) return NextResponse.json({ ok: false, error: 'Database non configurato' }, { status: 503 });

  const db = getDb();
  try {
    const columnsRes = await db.execute(sql.raw(`
      SELECT table_name, count(*)::int AS column_count
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name
    `));
    const sizeRes = await db.execute(sql.raw(`
      SELECT c.relname AS table_name, c.reltuples::bigint AS approx_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `));

    const columnCounts = new Map<string, number>();
    for (const row of columnsRes.rows as Array<{ table_name: string; column_count: number }>) {
      columnCounts.set(row.table_name, Number(row.column_count));
    }

    const tables = (sizeRes.rows as Array<{ table_name: string; approx_rows: number }>)
      .map((row) => ({
        name: row.table_name,
        columnCount: columnCounts.get(row.table_name) ?? 0,
        approxRows: Number(row.approx_rows) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ ok: true, tables });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore lettura schema' },
      { status: 500 },
    );
  }
}
