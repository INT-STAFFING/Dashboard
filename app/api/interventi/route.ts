import { NextResponse } from 'next/server';
import { createIntervento, listInterventi } from '@/lib/store';
import { getSessionUser, canView, canEdit } from '@/lib/auth';
import type { InterventoInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const me = await getSessionUser();
  if (!canView(me)) {
    return NextResponse.json({ ok: false, error: 'Non autorizzato' }, { status: 403 });
  }
  return NextResponse.json({ interventi: await listInterventi() });
}

// POST /api/interventi — create a new intervento (num_if + titolo required)
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!canEdit(me)) {
    return NextResponse.json(
      { ok: false, error: 'Permessi di modifica non concessi' },
      { status: 403 },
    );
  }
  let body: InterventoInput;
  try {
    body = (await req.json()) as InterventoInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  if (!body.numero_if || !body.titolo) {
    return NextResponse.json(
      { ok: false, error: 'numero_if e titolo sono obbligatori' },
      { status: 400 },
    );
  }
  try {
    const created = await createIntervento(body, me!.email);
    return NextResponse.json({ ok: true, created }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore' },
      { status: 409 },
    );
  }
}
