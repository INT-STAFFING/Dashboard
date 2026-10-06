import { unstable_cache } from 'next/cache';
import { SCHEMA_VERSION } from './db';
import { listInterventiBase } from './store';
import { factsToMap, listFacts, overlayMesi, parseAnno, pickDefaultAnno, yearsOf } from './mesiStore';
import { quotaValFromRti } from './config';
import { listAllBef, computeBefMonthlyTotals, computeBefAggregates } from './befStore';
import { getSettingsBulk } from './settings';
import { timed } from './perf';
import { SEED_FORNITORI, SEED_RTI, SEED_META, SEED_SENIORITY, SEED_MODALITA, SEED_TIMELINE } from './seed';
import {
  computeKpi,
  revenueMensile,
  distribuzioneAmbito,
  rtiSummary,
  fornitoreTimelineMulti,
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
// assembled from 4 parallel fetches: the five app_config keys travel in one
// batched select, quota_val is derived from the rti config already in hand, both
// BEF aggregates share a single bef_records read, and the monthly facts of every
// year come in one query (the selected year's profiles and the multi-year
// timeline are both derived from them).
//
// `requestedAnno` is the calendar year the per-intervento monthly profiles refer
// to; null means "the default": the current year if it has data, else the
// closest year that does. `currentYear` is only part of the cache key, so the
// default flips by itself on 1 January instead of waiting for a mutation.
async function assembleDashboardData(
  requestedAnno: number | null,
  currentYear: number,
): Promise<DashboardData & { revenue_mensile: ReturnType<typeof revenueMensile> }> {
  const [base, settings, befRows, facts] = await Promise.all([
    listInterventiBase(),
    getSettingsBulk({
      rti: SEED_RTI,
      meta: SEED_META,
      seniority: SEED_SENIORITY,
      modalita: SEED_MODALITA,
      timeline: SEED_TIMELINE,
    }),
    listAllBef(),
    listFacts(),
  ]);
  const anni = yearsOf(facts);
  const anno = requestedAnno ?? pickDefaultAnno(anni, new Date(currentYear, 5, 15));
  const all = overlayMesi(base, factsToMap(facts, anno));
  const rti = settings.rti as RtiConfig;
  const timeline = settings.timeline as Timeline;
  // Timeline tab is scoped to a single supplier (Intellera Consulting): the
  // revenue/consuntivato series is rebuilt from the per-IF monthly facts of the
  // Intellera interventi — for every year that has data, so the tab can offer
  // them all — instead of the portfolio-wide timeline_mensile table (which
  // stores no fornitore breakdown), and the BEF rows are filtered to
  // fornitore_reale = Intellera before aggregation. Every number shown in the
  // tab therefore excludes the other RTI partners.
  const timeline_my = fornitoreTimelineMulti(facts, all);
  const intelleraBef = befRows.filter((r) => isIntellera(r.fornitore_reale));
  return {
    anno,
    anni: anni.includes(anno) ? anni : [...anni, anno].sort((a, b) => a - b),
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
    revenue_mensile: revenueMensile(all, anno),
    distribuzione_ambito: distribuzioneAmbito(all),
  };
}

// `unstable_cache` persists each payload until `revalidateTag(DASHBOARD_DATA_TAG)`
// is called, instead of re-running the 4 parallel DB fetches above on every
// `/dashboard` render. The arguments are part of the cache key, so every year
// (and the "default" one) has its own entry; one revalidateTag drops them all.
// No time-based `revalidate` is set — see the tag comment above for why.
//
// The schema version is part of the cache key because the tag alone doesn't
// cover every way this payload can go stale. On Vercel the Data Cache is durable
// and survives deployments, so a bootstrap that *rewrites existing rows* (the
// IF-number repair in lib/db.ts) would otherwise keep serving the payload
// assembled before the repair: it goes straight to the tables, so none of the
// `revalidateTag` call sites listed in R-6 fire. Worse, while that payload stays
// cached nothing reads the interventi table, so the bootstrap that performs the
// repair never runs either. Bumping SCHEMA_VERSION now busts this key too.
//
// The timing below therefore measures only cache MISSES — the real cost of
// rebuilding the payload — and `payload_kb` is what gets serialized into the
// SSR HTML of /dashboard.
const cachedDashboardData = unstable_cache(
  (requestedAnno: number | null, currentYear: number) =>
    timed('dashboard_data', () => assembleDashboardData(requestedAnno, currentYear), (d) => ({
      anno: d.anno,
      interventi: d.interventi.length,
      payload_kb: Math.round(JSON.stringify(d).length / 1024),
    })),
  ['dashboard-data', `schema-v${SCHEMA_VERSION}`],
  { tags: [DASHBOARD_DATA_TAG] },
);

// `anno`: a valid calendar year, or anything else for "the default year". Invalid
// values are folded into the default, which also bounds the number of cache keys.
export function getDashboardData(anno?: unknown) {
  return cachedDashboardData(parseAnno(anno), new Date().getFullYear());
}
