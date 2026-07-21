import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { listRisorse, replaceRisorse } from '@/lib/risorse';
import { DASHBOARD_DATA_TAG } from '@/lib/getDashboardData';
import type { IfRisorsa } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { num_if: string } };

const FORBIDDEN = NextResponse.json(
  { ok: false, error: 'Riservato agli amministratori' },
  { status: 403 },
);

export async function GET(_req: Request, { params }: Params) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  return NextResponse.json({ ok: true, risorse: await listRisorse(params.num_if) });
}

// PUT { risorse: IfRisorsa[] } — replaces the full set for this IF/BO
export async function PUT(req: Request, { params }: Params) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  let body: { risorse?: IfRisorsa[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const saved = await replaceRisorse(params.num_if, body.risorse || []);
  // if_risorse isn't currently part of the getDashboardData() payload, but
  // this admin route mutates data and is one of the explicit invalidation
  // points for the dashboard cache tag (R-6) — kept for parity with the
  // other admin routes and to stay correct if that ever changes.
  revalidateTag(DASHBOARD_DATA_TAG);
  return NextResponse.json({ ok: true, risorse: saved });
}
