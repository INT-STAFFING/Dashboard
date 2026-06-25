import { NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getMeta, updateMeta, getRtiConfig, updateRtiConfig, type RtiUpdate } from '@/lib/config';
import type { Meta } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORBIDDEN = NextResponse.json(
  { ok: false, error: 'Riservato agli amministratori' },
  { status: 403 },
);

export async function GET() {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  const [meta, rti] = await Promise.all([getMeta(), getRtiConfig()]);
  return NextResponse.json({ ok: true, meta, rti });
}

// PUT { meta?: Partial<Meta>, rti?: RtiUpdate }
export async function PUT(req: Request) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  let body: { meta?: Partial<Meta>; rti?: RtiUpdate };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const meta = body.meta ? await updateMeta(body.meta) : await getMeta();
  const rti = body.rti ? await updateRtiConfig(body.rti) : await getRtiConfig();
  return NextResponse.json({ ok: true, meta, rti });
}
