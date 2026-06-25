import { SEED_RTI, SEED_QUOTA_VAL, SEED_META } from './seed';
import { getSetting, setSetting } from './settings';
import type { RtiConfig, Meta } from './types';

// RTI configuration ("valori di gara") — persisted via the generic settings
// store (DB-backed with in-memory fallback). Falls back to the baseline seed.
export async function getRtiConfig(): Promise<RtiConfig> {
  return getSetting<RtiConfig>('rti', SEED_RTI);
}

export type RtiUpdate = {
  massimale_totale?: number;
  quota_intellera_pct?: number;
  quota_deloitte_pct?: number;
  partners?: { name: string; pct: number }[];
};

// Update massimale and partner percentages; quotas are recomputed from the
// ceiling. When `partners` is supplied it replaces the full split (pct as a
// fraction 0..1); otherwise the legacy Intellera/Deloitte fields are applied.
export async function updateRtiConfig(input: RtiUpdate): Promise<RtiConfig> {
  const cur = await getRtiConfig();
  const ceiling = input.massimale_totale ?? cur.ceiling;
  let partners: RtiConfig['partners'];
  if (input.partners && input.partners.length) {
    partners = input.partners.map((p) => ({
      name: p.name,
      pct: p.pct,
      quota: ceiling * p.pct,
      impegnato: cur.partners.find((c) => c.name === p.name)?.impegnato ?? 0,
    }));
  } else {
    partners = cur.partners.map((p) => {
      let pct = p.pct;
      if (p.name === 'Intellera' && input.quota_intellera_pct != null) {
        pct = input.quota_intellera_pct / 100;
      }
      if (p.name === 'Deloitte' && input.quota_deloitte_pct != null) {
        pct = input.quota_deloitte_pct / 100;
      }
      return { ...p, pct, quota: ceiling * pct };
    });
  }
  return setSetting<RtiConfig>('rti', { ...cur, ceiling, partners });
}

export async function getQuotaVal(): Promise<Record<string, number>> {
  const cfg = await getRtiConfig();
  const out: Record<string, number> = { ...SEED_QUOTA_VAL };
  cfg.partners.forEach((p) => {
    out[p.name] = p.quota;
  });
  return out;
}

// Contract / tender metadata ("valori di gara"), editable from the admin page.
export async function getMeta(): Promise<Meta> {
  return getSetting<Meta>('meta', SEED_META);
}

export async function updateMeta(input: Partial<Meta>): Promise<Meta> {
  const cur = await getMeta();
  return setSetting<Meta>('meta', { ...cur, ...input });
}
