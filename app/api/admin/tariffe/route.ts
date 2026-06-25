import { NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getSeniority, setSeniority } from '@/lib/portfolio';
import type { Seniority } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORBIDDEN = NextResponse.json(
  { ok: false, error: 'Riservato agli amministratori' },
  { status: 403 },
);

export async function GET() {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  return NextResponse.json({ ok: true, seniority: await getSeniority() });
}

// PUT { seniority: Seniority[] } — global figure professionali / tariffe table
export async function PUT(req: Request) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  let body: { seniority?: Seniority[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const rows: Seniority[] = (body.seniority || []).map((r) => ({
    figura: String(r.figura ?? ''),
    code: String(r.code ?? ''),
    gg: Number(r.gg) || 0,
    tariffa: r.tariffa == null || (r.tariffa as unknown) === '' ? null : Number(r.tariffa),
  }));
  const saved = await setSeniority(rows);
  return NextResponse.json({ ok: true, seniority: saved });
}
