import { unstable_cache } from 'next/cache';
import { SCHEMA_VERSION } from './db';
import { listInterventi } from './store';
import { quotaValFromRti } from './config';
import { listAllBef, computeBefMonthlyTotals, computeBefAggregates } from './befStore';
import { getSettingsBulk } from './settings';
import { SEED_FORNITORI, SEED_RTI, SEED_META, SEED_SENIORITY, SEED_MODALITA, SEED_TIMELINE } from './seed';
import {
  computeKpi,
  revenueMensile,
  distribuzioneAmbito,
  rtiSummary,
  fornitoreTimeline,
  isIntellera,
} from './queries';
import type { DashboardData, RtiConfig, Meta, Seniority, ModalitaAgg, Timeline } from './types';

// Cache tag for the assembled dashboard payload (R-6, see
// docs/db-app-refactor-audit.md). The data only changes on an explicit
// mutation (upload, interventi CRUD, admin gara/tariffe/risorse/timeline,
// config RTI) — never on a schedule — so this is invalidated exclusively via
// `revalidateTag(DASHBOARD_DATA_TAG)` from every route handler that writes to
// any table this payload reads from. Every one of those call sites is listed
// in docs/db-app-refactor-audit.md (R-6) so a future table added to this
// payload can be cross-checked against the same list.
export const DASHBOARD_DATA_TAG = 'dashboard-data';

// Server-side assembly of the full dashboard payload (used by SSR). With the
// neon-http driver every query is an HTTP round-trip, so the payload is
// assembled from 4 parallel fetches instead of 10: the five app_config keys
// travel in one batched select, quota_val is derived from the rti config
// already in hand, and both BEF aggregates share a single bef_records read.
async function assembleDashboardData(): Promise<DashboardData & {
  revenue_mensile: ReturnType<typeof revenueMensile>;
}> {
  const [all, settings, befRows] = await Promise.all([
    listInterventi(),
    getSettingsBulk({
      rti: SEED_RTI,
      meta: SEED_META,
      seniority: SEED_SENIORITY,
      modalita: SEED_MODALITA,
      timeline: SEED_TIMELINE,
    }),
    listAllBef(),
  ]);
  const rti = settings.rti as RtiConfig;
  const timeline = settings.timeline as Timeline;
  // Timeline tab is scoped to a single supplier (Intellera Consulting): the
  // revenue/consuntivato series is rebuilt from the per-IF rev_mesi/cons_mesi
  // profiles of the Intellera interventi instead of the portfolio-wide
  // timeline_mensile table (which stores no fornitore breakdown), and the BEF
  // rows are filtered to fornitore_reale = Intellera before aggregation. Every
  // number shown in the tab therefore excludes the other RTI partners.
  const anno = timeline.anno || new Date().getFullYear();
  const timeline_my = fornitoreTimeline(all, anno);
  const intelleraBef = befRows.filter((r) => isIntellera(r.fornitore_reale));
  return {
    meta: settings.meta as Meta,
    fornitori_filter: SEED_FORNITORI,
    interventi: all,
    seniority: settings.seniority as Seniority[],
    modalita: settings.modalita as ModalitaAgg[],
    rti: { ...rti, ...rtiSummary(all, rti) },
    quota_val: quotaValFromRti(rti),
    timeline,
    timeline_my,
    bef_monthly: computeBefMonthlyTotals(intelleraBef),
    bef_aggregates: computeBefAggregates(intelleraBef),
    kpi: computeKpi(all),
    revenue_mensile: revenueMensile(all),
    distribuzione_ambito: distribuzioneAmbito(all),
  };
}

// `unstable_cache` persists the payload until `revalidateTag(DASHBOARD_DATA_TAG)`
// is called, instead of re-running the 4 parallel DB fetches above on every
// `/dashboard` render. No time-based `revalidate` is set — see the tag comment
// above for why.
//
// The schema version is part of the cache key because the tag alone doesn't
// cover every way this payload can go stale. On Vercel the Data Cache is durable
// and survives deployments, so a bootstrap that *rewrites existing rows* (the
// IF-number repair in lib/db.ts) would otherwise keep serving the payload
// assembled before the repair: it goes straight to the tables, so none of the
// `revalidateTag` call sites listed in R-6 fire. Worse, while that payload stays
// cached nothing reads the interventi table, so the bootstrap that performs the
// repair never runs either. Bumping SCHEMA_VERSION now busts this key too.
export const getDashboardData = unstable_cache(
  assembleDashboardData,
  ['dashboard-data', `schema-v${SCHEMA_VERSION}`],
  { tags: [DASHBOARD_DATA_TAG] },
);
