import { listInterventi } from './store';
import { getRtiConfig, getQuotaVal, getMeta } from './config';
import { getSeniority, getModalita, getTimeline } from './portfolio';
import { SEED_FORNITORI } from './seed';
import { computeKpi, revenueMensile, distribuzioneAmbito, rtiSummary } from './queries';
import type { DashboardData } from './types';

// Server-side assembly of the full dashboard payload (used by SSR + GET /api/data).
export async function getDashboardData(): Promise<DashboardData & {
  revenue_mensile: ReturnType<typeof revenueMensile>;
}> {
  const [all, rti, meta, seniority, modalita, quota_val, timeline] = await Promise.all([
    listInterventi(),
    getRtiConfig(),
    getMeta(),
    getSeniority(),
    getModalita(),
    getQuotaVal(),
    getTimeline(),
  ]);
  return {
    meta,
    fornitori_filter: SEED_FORNITORI,
    interventi: all,
    seniority,
    modalita,
    rti: { ...rti, ...rtiSummary(all, rti) },
    quota_val,
    timeline,
    kpi: computeKpi(all),
    revenue_mensile: revenueMensile(all),
    distribuzione_ambito: distribuzioneAmbito(all),
  };
}
