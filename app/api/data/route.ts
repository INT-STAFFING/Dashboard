import { NextResponse } from 'next/server';
import { listInterventi } from '@/lib/store';
import { getSessionUser, canView } from '@/lib/auth';
import { getRtiConfig, getQuotaVal, META } from '@/lib/config';
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
  const filters: Filters = {
    forn: searchParams.get('fornitore') || undefined,
    ref: searchParams.get('ref_aria') || undefined,
    refint: searchParams.get('ref_fornitore') || undefined,
    amb: searchParams.get('ambito') || undefined,
    att: searchParams.get('attivazione') || undefined,
    mod: searchParams.get('modalita') || undefined,
    stato: searchParams.get('stato_bo') || searchParams.get('stato') || undefined,
  };

  const all = await listInterventi();
  const hasFilter = Object.values(filters).some(Boolean);
  const view = hasFilter ? filterInterventi(all, filters) : all;
  const rti = getRtiConfig();

  return NextResponse.json({
    meta: META,
    fornitori_filter: SEED_FORNITORI,
    interventi: all,
    view_count: view.length,
    kpi: computeKpi(view),
    revenue_mensile: revenueMensile(view),
    distribuzione_ambito: distribuzioneAmbito(view),
    rti: { ...rti, ...rtiSummary(view, rti) },
    quota_val: getQuotaVal(),
    seniority: getSeniority(),
    modalita: getModalita(),
    timeline: getTimeline(),
  });
}
