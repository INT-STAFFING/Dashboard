import { listInterventi } from './store';
import { quotaValFromRti } from './config';
import { getMultiYearTimeline } from './timelineStore';
import { listAllBef, computeBefMonthlyTotals, computeBefAggregates } from './befStore';
import { getSettingsBulk } from './settings';
import { SEED_FORNITORI, SEED_RTI, SEED_META, SEED_SENIORITY, SEED_MODALITA, SEED_TIMELINE } from './seed';
import { computeKpi, revenueMensile, distribuzioneAmbito, rtiSummary } from './queries';
import type { DashboardData, RtiConfig, Meta, Seniority, ModalitaAgg, Timeline } from './types';

// Server-side assembly of the full dashboard payload (used by SSR + GET /api/data).
// With the neon-http driver every query is an HTTP round-trip, so the payload
// is assembled from 4 parallel fetches instead of 10: the five app_config keys
// travel in one batched select, quota_val is derived from the rti config
// already in hand, and both BEF aggregates share a single bef_records read.
export async function getDashboardData(): Promise<DashboardData & {
  revenue_mensile: ReturnType<typeof revenueMensile>;
}> {
  const [all, settings, timeline_my, befRows] = await Promise.all([
    listInterventi(),
    getSettingsBulk({
      rti: SEED_RTI,
      meta: SEED_META,
      seniority: SEED_SENIORITY,
      modalita: SEED_MODALITA,
      timeline: SEED_TIMELINE,
    }),
    getMultiYearTimeline(),
    listAllBef(),
  ]);
  const rti = settings.rti as RtiConfig;
  return {
    meta: settings.meta as Meta,
    fornitori_filter: SEED_FORNITORI,
    interventi: all,
    seniority: settings.seniority as Seniority[],
    modalita: settings.modalita as ModalitaAgg[],
    rti: { ...rti, ...rtiSummary(all, rti) },
    quota_val: quotaValFromRti(rti),
    timeline: settings.timeline as Timeline,
    timeline_my,
    bef_monthly: computeBefMonthlyTotals(befRows),
    bef_aggregates: computeBefAggregates(befRows),
    kpi: computeKpi(all),
    revenue_mensile: revenueMensile(all),
    distribuzione_ambito: distribuzioneAmbito(all),
  };
}
