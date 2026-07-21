import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { updateRtiConfig, type RtiUpdate } from '@/lib/config';
import { getSessionUser, canEdit } from '@/lib/auth';
import { DASHBOARD_DATA_TAG } from '@/lib/getDashboardData';

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
  try {
    const updated = await updateRtiConfig(body);
    revalidateTag(DASHBOARD_DATA_TAG);
    return NextResponse.json({ ok: true, rti: updated });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore' },
      { status: 400 },
    );
  }
}
