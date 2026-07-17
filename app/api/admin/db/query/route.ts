import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { revalidateTag } from 'next/cache';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getDb, hasDB } from '@/lib/db';
import { DASHBOARD_DATA_TAG } from '@/lib/getDashboardData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORBIDDEN = NextResponse.json(
  { ok: false, error: 'Riservato agli amministratori' },
  { status: 403 },
);

// POST { query: string } -> esegue una singola istruzione SQL sul database.
// Riservato agli amministratori: consente qualsiasi operazione (SELECT/INSERT/
// UPDATE/DELETE/DDL), quindi va usata con cautela.
export async function POST(req: Request) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  if (!hasDB) return NextResponse.json({ ok: false, error: 'Database non configurato' }, { status: 503 });

  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }

  const query = (body.query || '').trim().replace(/;\s*$/, '');
  if (!query) {
    return NextResponse.json({ ok: false, error: 'Query vuota' }, { status: 400 });
  }
  // Il driver neon-http esegue una singola istruzione per round-trip: un ';'
  // seguito da altro testo indica istruzioni concatenate, non supportate qui.
  if (/;/.test(query)) {
    return NextResponse.json(
      { ok: false, error: 'Una sola istruzione SQL per esecuzione (rimuovi i ";" interni)' },
      { status: 400 },
    );
  }

  const db = getDb();
  try {
    const started = Date.now();
    const result = await db.execute(sql.raw(query));
    // This console can run arbitrary SQL (any table, any statement type), so
    // there's no reliable way to tell from the query text alone whether it
    // touched something the dashboard cache reads. Revalidate defensively on
    // every successful execution — an admin-only, low-frequency tool, so the
    // cost of an occasional unnecessary cache miss is negligible next to the
    // risk of stale dashboard data after an admin edit made through here.
    revalidateTag(DASHBOARD_DATA_TAG);
    return NextResponse.json({
      ok: true,
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore esecuzione query' },
      { status: 400 },
    );
  }
}
