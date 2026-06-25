import { NextResponse } from 'next/server';
import { listInterventi } from '@/lib/store';
import { getSessionUser, canView } from '@/lib/auth';
import { getRtiConfig, getQuotaVal, getMeta } from '@/lib/config';
import { getSeniority, getModalita, getTimeline } from '@/lib/portfolio';
import { SEED_FORNITORI } from '@/lib/seed';
import {
  filterInterventi,
  computeKpi,
  revenueMensile,
  distribuzioneAmbito,
  rtiSummary,
  type Filters,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!canView(await getSessionUser())) {
    return NextResponse.json({ ok: false, error: 'Non autorizzato' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  // Multi-select dimensions accept repeated/comma-separated query params.
  const multi = (key: string): string[] | undefined => {
    const all = searchParams.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    return all.length ? all : undefined;
  };
  const filters: Filters = {
    forn: multi('fornitore'),
    ref: multi('ref_aria'),
    refint: multi('ref_fornitore'),
    amb: multi('ambito'),
    stato: multi('stato_bo') || multi('stato'),
    att: searchParams.get('attivazione') || undefined,
    mod: searchParams.get('modalita') || undefined,
  };

  const [all, rti, meta, quota_val, seniority, modalita, timeline] = await Promise.all([
    listInterventi(),
    getRtiConfig(),
    getMeta(),
    getQuotaVal(),
    getSeniority(),
    getModalita(),
    getTimeline(),
  ]);
  const hasFilter = Object.values(filters).some((v) => (Array.isArray(v) ? v.length : Boolean(v)));
  const view = hasFilter ? filterInterventi(all, filters) : all;

  return NextResponse.json({
    meta,
    fornitori_filter: SEED_FORNITORI,
    interventi: all,
    view_count: view.length,
    kpi: computeKpi(view),
    revenue_mensile: revenueMensile(view),
    distribuzione_ambito: distribuzioneAmbito(view),
    rti: { ...rti, ...rtiSummary(view, rti) },
    quota_val,
    seniority,
    modalita,
    timeline,
  });
}
