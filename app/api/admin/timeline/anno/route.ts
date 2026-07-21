import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { setTimelineYear, getMultiYearTimeline } from '@/lib/timelineStore';
import { DASHBOARD_DATA_TAG } from '@/lib/getDashboardData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORBIDDEN = NextResponse.json(
  { ok: false, error: 'Riservato agli amministratori' },
  { status: 403 },
);

const v12 = (a: unknown): number[] => {
  const out = Array(12).fill(0) as number[];
  if (Array.isArray(a)) for (let i = 0; i < 12; i++) out[i] = Number(a[i]) || 0;
  return out;
};

// PUT { anno: number, revenue: number[12], consuntivato: number[12] }
// Replaces the full 12-month set for one calendar year (multi-year store).
export async function PUT(req: Request) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  let body: { anno?: number; revenue?: unknown; consuntivato?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const anno = Number(body.anno);
  if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) {
    return NextResponse.json({ ok: false, error: 'Anno non valido' }, { status: 400 });
  }
  await setTimelineYear(anno, v12(body.revenue), v12(body.consuntivato));
  revalidateTag(DASHBOARD_DATA_TAG);
  return NextResponse.json({ ok: true, timeline_my: await getMultiYearTimeline() });
}

export async function GET() {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  return NextResponse.json({ ok: true, timeline_my: await getMultiYearTimeline() });
}
