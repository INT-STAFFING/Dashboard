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

const MAX_LIMIT = 200;

// GET -> colonne + righe di esempio (paginate) per una tabella dello schema public
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  if (!hasDB) return NextResponse.json({ ok: false, error: 'Database non configurato' }, { status: 503 });

  const { name } = await params;
  const db = getDb();

  const existsRes = await db.execute(
    sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${name} LIMIT 1`,
  );
  if (existsRes.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'Tabella non trovata' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0);

  try {
    const columnsRes = await db.execute(
      sql`SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${name}
          ORDER BY ordinal_position`,
    );
    // Il nome tabella è già stato verificato contro information_schema.tables sopra,
    // quindi è sicuro interpolarlo come identificatore tra virgolette.
    const ident = '"' + name.replace(/"/g, '""') + '"';
    const rowsRes = await db.execute(
      sql.raw(`SELECT * FROM ${ident} LIMIT ${limit} OFFSET ${offset}`),
    );
    const countRes = await db.execute(sql.raw(`SELECT count(*)::int AS total FROM ${ident}`));

    return NextResponse.json({
      ok: true,
      columns: columnsRes.rows,
      rows: rowsRes.rows,
      total: (countRes.rows[0] as { total: number } | undefined)?.total ?? 0,
      limit,
      offset,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore lettura tabella' },
      { status: 500 },
    );
  }
}
