import { NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { listRisorse, replaceRisorse } from '@/lib/risorse';
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
  return NextResponse.json({ ok: true, risorse: saved });
}
