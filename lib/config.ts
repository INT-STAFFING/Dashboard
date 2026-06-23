import { SEED_RTI, SEED_QUOTA_VAL, SEED_META } from './seed';
import type { RtiConfig } from './types';

// RTI configuration is small and rarely changed; kept in a global so manual
// edits survive within a server instance even without a database.
const g = globalThis as unknown as { __ARIA_RTI__?: RtiConfig };

export function getRtiConfig(): RtiConfig {
  if (!g.__ARIA_RTI__) {
    g.__ARIA_RTI__ = JSON.parse(JSON.stringify(SEED_RTI)) as RtiConfig;
  }
  return g.__ARIA_RTI__;
}

export type RtiUpdate = {
  massimale_totale?: number;
  quota_intellera_pct?: number;
  quota_deloitte_pct?: number;
};

// Update massimale and the Intellera/Deloitte split. Remaining partners keep
// their existing percentage; quotas are recomputed from the ceiling.
export function updateRtiConfig(input: RtiUpdate): RtiConfig {
  const cur = getRtiConfig();
  const ceiling = input.massimale_totale ?? cur.ceiling;
  const partners = cur.partners.map((p) => {
    let pct = p.pct;
    if (p.name === 'Intellera' && input.quota_intellera_pct != null) {
      pct = input.quota_intellera_pct / 100;
    }
    if (p.name === 'Deloitte' && input.quota_deloitte_pct != null) {
      pct = input.quota_deloitte_pct / 100;
    }
    return { ...p, pct, quota: ceiling * pct };
  });
  g.__ARIA_RTI__ = { ...cur, ceiling, partners };
  return g.__ARIA_RTI__;
}

export function getQuotaVal(): Record<string, number> {
  const cfg = getRtiConfig();
  const out: Record<string, number> = { ...SEED_QUOTA_VAL };
  cfg.partners.forEach((p) => {
    out[p.name] = p.quota;
  });
  return out;
}

export const META = SEED_META;
