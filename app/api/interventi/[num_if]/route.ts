import { NextResponse } from 'next/server';
import {
  getIntervento,
  updateIntervento,
  softDeleteIntervento,
} from '@/lib/store';
import type { InterventoInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: { num_if: string } };

export async function GET(_req: Request, { params }: Params) {
  const found = await getIntervento(params.num_if);
  if (!found) {
    return NextResponse.json({ ok: false, error: 'Non trovato' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, intervento: found });
}

// PUT /api/interventi/[num_if] — PATCH-semantic update of a single intervento
export async function PUT(req: Request, { params }: Params) {
  let body: InterventoInput;
  try {
    body = (await req.json()) as InterventoInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const updated = await updateIntervento(
    params.num_if,
    body,
    req.headers.get('user-agent') || 'ui',
  );
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Non trovato' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, updated });
}

// DELETE /api/interventi/[num_if] — soft-delete (sets deleted_at)
export async function DELETE(_req: Request, { params }: Params) {
  const ok = await softDeleteIntervento(params.num_if);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Non trovato' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
