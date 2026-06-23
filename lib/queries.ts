import type { Intervento, Kpi, RtiConfig } from './types';
import { MESI } from './format';

export type Filters = {
  forn?: string;
  ref?: string;
  refint?: string;
  amb?: string;
  att?: string;
  mod?: string;
  stato?: string;
};

const modKey = (s: string | null) => (s || '').toLowerCase();

// Port of getIFs() from the original dashboard.
export function filterInterventi(all: Intervento[], f: Filters): Intervento[] {
  return all.filter(
    (i) =>
      (!f.forn || i.fornitore === f.forn) &&
      (!f.ref || i.ref_aria === f.ref) &&
      (!f.refint || i.ref_fornitore === f.refint) &&
      (!f.amb || i.ambito === f.amb) &&
      (!f.att || i.attivazione === f.att) &&
      (!f.mod ||
        (i.modalita_if &&
          modKey(i.modalita_if).includes(modKey(f.mod).replace('a ', '')))) &&
      (!f.stato || i.stato === f.stato),
  );
}

export function computeKpi(IFs: Intervento[]): Kpi {
  const totale = IFs.reduce((s, i) => s + i.importo, 0);
  const bo_emessi = IFs.filter((i) => i.has_bo).length;
  const intellera = IFs.filter((i) => i.fornitore === 'Intellera').length;
  const deloitte = IFs.filter((i) => i.fornitore === 'Deloitte').length;
  return {
    count: IFs.length,
    totale,
    medio: IFs.length ? totale / IFs.length : 0,
    bo_emessi,
    bo_attesa: IFs.length - bo_emessi,
    intellera,
    deloitte,
  };
}

// Revenue per month split by partner, from each intervento's rev_mesi profile.
export function revenueMensile(IFs: Intervento[]) {
  return MESI.map((mese, mi) => {
    let intellera = 0;
    let deloitte = 0;
    for (const i of IFs) {
      const v = (i.rev_mesi && i.rev_mesi[mi]) || 0;
      if (i.fornitore === 'Intellera') intellera += v;
      else if (i.fornitore === 'Deloitte') deloitte += v;
    }
    return { mese: `2026-${String(mi + 1).padStart(2, '0')}`, label: mese, intellera, deloitte };
  });
}

export function distribuzioneAmbito(IFs: Intervento[]) {
  const agg: Record<string, { count: number; valore: number }> = {};
  for (const i of IFs) {
    const k = i.ambito || 'Non classificato';
    (agg[k] = agg[k] || { count: 0, valore: 0 }).valore += i.importo;
    agg[k].count += 1;
  }
  return Object.entries(agg)
    .map(([ambito, v]) => ({ ambito, count: v.count, valore: v.valore }))
    .sort((a, b) => b.valore - a.valore);
}

// Impegnato (committed) per RTI partner from the filtered view.
export function impegnatoPerPartner(IFs: Intervento[], rti: RtiConfig) {
  const out: Record<string, number> = {};
  rti.partners.forEach((p) => (out[p.name] = 0));
  IFs.forEach((i) => {
    if (out[i.fornitore] != null) out[i.fornitore] += i.importo;
  });
  return out;
}

export function rtiSummary(IFs: Intervento[], rti: RtiConfig) {
  const impegnato = IFs.reduce((s, i) => s + i.importo, 0);
  return {
    massimale: rti.ceiling,
    partners: rti.partners,
    impegnato,
    erosione_pct: rti.ceiling ? (impegnato / rti.ceiling) * 100 : 0,
  };
}
