import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import {
  getIntervento,
  updateIntervento,
  softDeleteIntervento,
} from '@/lib/store';
import { getSessionUser, canView, canEdit } from '@/lib/auth';
import { DASHBOARD_DATA_TAG } from '@/lib/getDashboardData';
import type { InterventoInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { num_if: string } };

const FORBIDDEN = NextResponse.json(
  { ok: false, error: 'Permessi di modifica non concessi' },
  { status: 403 },
);

export async function GET(_req: Request, { params }: Params) {
  if (!canView(await getSessionUser())) {
    return NextResponse.json({ ok: false, error: 'Non autorizzato' }, { status: 403 });
  }
  const found = await getIntervento(params.num_if);
  if (!found) {
    return NextResponse.json({ ok: false, error: 'Non trovato' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, intervento: found });
}

// PUT /api/interventi/[num_if] — PATCH-semantic update of a single intervento
export async function PUT(req: Request, { params }: Params) {
  const me = await getSessionUser();
  if (!canEdit(me)) return FORBIDDEN;
  let body: InterventoInput;
  try {
    body = (await req.json()) as InterventoInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  try {
    const updated = await updateIntervento(params.num_if, body, me!.email);
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'Non trovato' }, { status: 404 });
    }
    revalidateTag(DASHBOARD_DATA_TAG);
    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore' },
      { status: 400 },
    );
  }
}

// DELETE /api/interventi/[num_if] — soft-delete (sets deleted_at)
export async function DELETE(_req: Request, { params }: Params) {
  if (!canEdit(await getSessionUser())) return FORBIDDEN;
  const ok = await softDeleteIntervento(params.num_if);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Non trovato' }, { status: 404 });
  }
  revalidateTag(DASHBOARD_DATA_TAG);
  return NextResponse.json({ ok: true });
}
