import type { Intervento, Kpi, RtiConfig } from './types';
import { MESI } from './format';

// Multi-select dimensions use string[] (OR semantics within a dimension, AND
// across dimensions). Single-select / boolean dimensions stay scalar.
export type Filters = {
  forn?: string[]; // Fornitore — multi
  ref?: string[]; // Referente ARIA — multi
  refint?: string[]; // Referente Intellera — multi
  amb?: string[]; // Ambito — multi
  stato?: string[]; // Stato IF — multi
  mod?: string; // Modalità — single (radio)
  att?: string; // Attivazione immediata — boolean toggle ('SI')
  bo?: string; // BO emesso — boolean toggle ('SI'), secondary
  sub?: string; // Subappalto — boolean toggle ('SI'), secondary
};

export const modKey = (s: string | null) => (s || '').toLowerCase();

// True when a multi-select dimension is empty/absent, or the row's value is one
// of the selected options (OR within the dimension).
const inSet = (sel: string[] | undefined, v: string | null) =>
  !sel || sel.length === 0 || (v != null && sel.includes(v));

// Modalità matcher kept identical to the original fuzzy "contains" logic.
export const matchesMod = (modalita: string | null, mod: string) =>
  !!modalita && modKey(modalita).includes(modKey(mod).replace('a ', ''));

// Port of getIFs() from the original dashboard, generalised to multi-select.
export function filterInterventi(all: Intervento[], f: Filters): Intervento[] {
  return all.filter(
    (i) =>
      inSet(f.forn, i.fornitore) &&
      inSet(f.ref, i.ref_aria) &&
      inSet(f.refint, i.ref_fornitore) &&
      inSet(f.amb, i.ambito) &&
      inSet(f.stato, i.stato) &&
      (!f.mod || matchesMod(i.modalita_if, f.mod)) &&
      (!f.att || i.attivazione === f.att) &&
      (!f.bo || i.has_bo) &&
      (!f.sub || i.subappalto),
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
