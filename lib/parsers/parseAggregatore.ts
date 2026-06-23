import type { Intervento, Seniority } from '../types';
import { readWorkbook, sheetRows, findSheet, toNumber, toISODate, str } from './util';

export type AggregatoreResult = {
  seniority: Seniority[];
  interventi: Intervento[];
};

// Short codes for the most common professional figures.
// keys are normalized (lower-case, hyphens -> spaces)
const FIGURE_CODE: Record<string, string> = {
  'health care consultant junior': 'HCJ',
  'health care consultant senior': 'HCS',
  'health care consultant manager': 'HCM',
  'business consultant junior': 'BCJ',
  'business consultant senior': 'BCS',
  'business consultant manager': 'BCM',
  'strategy consultant': 'SC',
  'program manager': 'PROM',
  'project manager': 'PRJM',
};

function codeFor(figura: string): string {
  const key = figura.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return FIGURE_CODE[key] || figura;
}

// Parse the Aggregatore Modulo 106 workbook: GdL -> seniority distribution,
// Generalità (+ Oggetto Fornitura) -> interventi with modalità/subappalto.
export function parseAggregatore(input: ArrayBuffer | Buffer): AggregatoreResult {
  const wb = readWorkbook(input);

  // --- Seniority from "GdL - Gruppo di Lavoro" ---
  const seniority: Seniority[] = [];
  const gdlSheet = findSheet(wb, 'GdL - Gruppo di Lavoro', 'GdL');
  if (gdlSheet) {
    const agg = new Map<string, number>();
    for (const r of sheetRows(wb, gdlSheet, 0)) {
      const figura = str(r['Figure Professionali']);
      if (!figura) continue;
      agg.set(figura, (agg.get(figura) || 0) + toNumber(r['GG / Uomo']));
    }
    for (const [figura, gg] of [...agg.entries()].sort((a, b) => b[1] - a[1])) {
      seniority.push({ figura, code: codeFor(figura), gg, tariffa: null });
    }
  }

  // --- Oggetto Fornitura: aggregate subappalto / modalità by source file ---
  const ofSheet = findSheet(wb, 'Oggetto Fornitura', 'Oggetto');
  const ofByFile = new Map<
    string,
    { modalita: Set<string>; sub: boolean; subNames: Set<string>; costoSub: number; fornitore: string | null }
  >();
  if (ofSheet) {
    for (const r of sheetRows(wb, ofSheet, 0)) {
      const file = str(r['File Sorgente']);
      if (!file) continue;
      const e =
        ofByFile.get(file) ||
        { modalita: new Set<string>(), sub: false, subNames: new Set<string>(), costoSub: 0, fornitore: null };
      const mod = str(r['Modalità Fornitura']);
      if (mod) e.modalita.add(mod.replace('_', ' '));
      if (/^s[iì]$/i.test(String(r['Subappalto SI/NO'] ?? ''))) {
        e.sub = true;
        const sn = str(r['Subappaltatore']);
        if (sn) e.subNames.add(sn);
        e.costoSub += toNumber(r['Costo Totale Subappaltato']);
      }
      if (!e.fornitore) {
        const f = str(r['Fornitore']);
        if (f) e.fornitore = /deloitte/i.test(f) ? 'Deloitte' : 'Intellera';
      }
      ofByFile.set(file, e);
    }
  }

  // --- Interventi from "Generalità Intervento" ---
  const interventi: Intervento[] = [];
  const genSheet = findSheet(wb, 'Generalità Intervento', 'Generalità');
  if (genSheet) {
    for (const r of sheetRows(wb, genSheet, 0)) {
      const numero_if = str(r['Numero IF']);
      const titolo = str(r['Titolo Intervento']);
      if (!numero_if || !titolo) continue;
      const file = str(r['File Sorgente']);
      const of = file ? ofByFile.get(file) : undefined;
      const refMail = String(r['Ref. Fornitore - Mail'] ?? '');
      const fornitore =
        of?.fornitore || (/deloitte/i.test(refMail) ? 'Deloitte' : 'Intellera');
      const hasBdo = str(r['Codice Ultimo BDO']) != null;

      interventi.push({
        numero_if,
        bdo: str(r['Codice Ultimo BDO']),
        titolo,
        ambito: str(r['Macro Classe']) ? `Macro ${str(r['Macro Classe'])}` : 'Altro',
        fornitore,
        ref_aria: str(r['Ref. ARIA - Nome Cognome']),
        ref_fornitore: str(r['Ref. Fornitore - Nome Cognome']),
        importo: toNumber(r['Importo Intervento']),
        revenue_2026: 0,
        rev_mesi: Array(12).fill(0),
        modalita_if: of && of.modalita.size ? [...of.modalita].join(' + ') : null,
        attivazione: 'NO',
        stato: hasBdo ? 'approvato' : 'non elaborato',
        has_bo: hasBdo,
        pdc: 'nd',
        v_apertura: 'nd',
        v_sal: 'nd',
        bef: 'nd',
        subappalto: of?.sub ?? false,
        subappaltatore: of ? [...of.subNames] : [],
        costo_subappalto: of?.costoSub ?? 0,
        data_assegnazione: toISODate(r['Data Assegnazione IF']),
        data_inizio: toISODate(r['Data Inizio Attività']),
        data_fine: toISODate(r['Data Fine Attività']),
        azione: null,
        note_operative: null,
        edited_manually: false,
        last_edited_at: null,
        last_edited_by: null,
      });
    }
  }

  return { seniority, interventi };
}
