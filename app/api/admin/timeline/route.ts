import { NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getTimeline, setTimeline } from '@/lib/portfolio';
import type { Timeline } from '@/lib/types';

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

export async function GET() {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  return NextResponse.json({ ok: true, timeline: await getTimeline() });
}

// PUT { revenue_2026: number[12], consuntivazione_2026: number[12], anno?: number }
export async function PUT(req: Request) {
  if (!isAdmin(await getSessionUser())) return FORBIDDEN;
  let body: Partial<Timeline>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }
  const cur = await getTimeline();
  const next: Timeline = {
    ...cur,
    revenue_2026: body.revenue_2026 ? v12(body.revenue_2026) : cur.revenue_2026,
    consuntivazione_2026: body.consuntivazione_2026
      ? v12(body.consuntivazione_2026)
      : cur.consuntivazione_2026,
    anno: body.anno ?? cur.anno,
  };
  return NextResponse.json({ ok: true, timeline: await setTimeline(next) });
}
