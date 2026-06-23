import { NextResponse } from 'next/server';
import { updateRtiConfig, type RtiUpdate } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  let body: RtiUpdate;
  try {
    body = (await req.json()) as RtiUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const updated = updateRtiConfig(body);
  return NextResponse.json({ ok: true, rti: updated });
}
