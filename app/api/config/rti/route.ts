import { NextResponse } from 'next/server';
import { updateRtiConfig, type RtiUpdate } from '@/lib/config';
import { getSessionUser, canEdit } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: Request) {
  if (!canEdit(await getSessionUser())) {
    return NextResponse.json(
      { ok: false, error: 'Permessi di modifica non concessi' },
      { status: 403 },
    );
  }
  let body: RtiUpdate;
  try {
    body = (await req.json()) as RtiUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const updated = updateRtiConfig(body);
  return NextResponse.json({ ok: true, rti: updated });
}
