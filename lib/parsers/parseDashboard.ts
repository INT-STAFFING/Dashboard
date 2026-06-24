import type { Intervento, Seniority } from '../types';
import {
  readWorkbook,
  sheetMatrix,
  findSheet,
  toNumber,
  toISODate,
  str,
  type Workbook,
} from './util';
import { codeFor } from './parseAggregatore';

export type DashboardResult = {
  seniority: Seniority[];
  interventi: Intervento[];
};

const YEAR = 2026;

// Build a name -> column-index map from a header row.
function headerIndex(header: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const k = String(h ?? '').trim();
    if (k) map[k] = i;
  });
  return map;
}

// Locate the header row by a column it must contain. Sheets in this workbook
// have a variable number of title/blank rows above the header, and the reader
// drops blank rows, so a fixed index can't be relied on.
function findHeaderRow(matrix: unknown[][], key: string): number {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    if (Array.isArray(row) && row.some((c) => String(c ?? '').trim() === key)) return r;
  }
  return -1;
}

// Sum the per-IF monthly revenue for YEAR from the "TIMELINE_REVENUE" sheet.
// Layout: header on row index 1 with "Numero IF" + one date column per month;
// each data row is a single DATI line, so multiple rows share a Numero IF.
function revenueByIf(wb: Workbook): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const sheet = findSheet(wb, 'TIMELINE_REVENUE');
  if (!sheet) return out;
  const m = sheetMatrix(wb, sheet);
  const hr = findHeaderRow(m, 'Numero IF');
  if (hr < 0) return out;

  const header = m[hr] as unknown[];
  const hi = headerIndex(header);
  const ifCol = hi['Numero IF'] ?? 0;
  // Columns whose header is a Date in the target year -> month 0..11.
  const monthCol: number[] = Array(12).fill(-1);
  header.forEach((h, i) => {
    if (h instanceof Date && h.getFullYear() === YEAR) monthCol[h.getMonth()] = i;
  });

  for (let r = hr + 1; r < m.length; r++) {
    const row = m[r] as unknown[];
    if (!row) continue;
    const id = str(row[ifCol]);
    if (!id) continue;
    const arr = out.get(id) ?? Array(12).fill(0);
    for (let mi = 0; mi < 12; mi++) {
      const c = monthCol[mi];
      if (c < 0) continue;
      const v = row[c];
      if (typeof v === 'number' && Number.isFinite(v)) arr[mi] += v;
    }
    out.set(id, arr);
  }
  return out;
}

// Seniority distribution from the "GIORNI_UOMO" sheet (header on row index 2).
function seniorityFromGdl(wb: Workbook): Seniority[] {
  const sheet = findSheet(wb, 'GIORNI_UOMO');
  if (!sheet) return [];
  const m = sheetMatrix(wb, sheet);
  const hr = findHeaderRow(m, 'Figura Professionale');
  if (hr < 0) return [];
  const hi = headerIndex(m[hr] as unknown[]);
  const figCol = hi['Figura Professionale'];
  const ggCol = hi['GG / Uomo'];
  if (figCol == null || ggCol == null) return [];

  const agg = new Map<string, number>();
  for (let r = hr + 1; r < m.length; r++) {
    const row = m[r] as unknown[];
    const figura = str(row?.[figCol]);
    if (!figura) continue;
    agg.set(figura, (agg.get(figura) || 0) + toNumber(row[ggCol]));
  }
  return [...agg.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([figura, gg]) => ({ figura, code: codeFor(figura), gg, tariffa: null }));
}

type Acc = {
  importo: number;
  titolo: string | null;
  fornitore: string | null;
  modalita: Set<string>;
  sub: boolean;
  subNames: Set<string>;
  costoSub: number;
  dataInizio: string | null;
  dataFine: string | null;
  bdo: string | null;
};

// Parse the master "Dashboard ARIA SISS" workbook. Interventi come from the
// milestone-level "DATI" sheet (aggregated per IF) and the monthly revenue
// profile from "TIMELINE_REVENUE"; seniority from "GIORNI_UOMO".
export function parseDashboard(input: ArrayBuffer | Buffer | Workbook): DashboardResult {
  const wb = isWorkbook(input) ? input : readWorkbook(input);

  const rev = revenueByIf(wb);
  const seniority = seniorityFromGdl(wb);

  const interventi: Intervento[] = [];
  const datiSheet = findSheet(wb, 'DATI');
  if (!datiSheet) return { seniority, interventi };

  const m = sheetMatrix(wb, datiSheet);
  const hr = findHeaderRow(m, 'Numero IF');
  if (hr < 0) return { seniority, interventi };
  const hi = headerIndex(m[hr] as unknown[]);
  const col = (name: string) => hi[name];

  const acc = new Map<string, Acc>();
  const order: string[] = [];
  for (let r = hr + 1; r < m.length; r++) {
    const row = m[r] as unknown[];
    const numero_if = str(row?.[col('Numero IF')]);
    if (!numero_if) continue;

    let a = acc.get(numero_if);
    if (!a) {
      a = {
        importo: 0,
        titolo: null,
        fornitore: null,
        modalita: new Set<string>(),
        sub: false,
        subNames: new Set<string>(),
        costoSub: 0,
        dataInizio: null,
        dataFine: null,
        bdo: null,
      };
      acc.set(numero_if, a);
      order.push(numero_if);
    }

    a.importo += toNumber(row[col('Costo Complessivo')]);
    const tit = str(row[col('Titolo Intervento')]);
    if (tit) a.titolo = tit;

    const forn = str(row[col('Fornitore')]);
    if (forn) a.fornitore = /deloitte/i.test(forn) ? 'Deloitte' : 'Intellera';

    const mod = str(row[col('Modalità Fornitura')]);
    if (mod) a.modalita.add(mod.replace(/_/g, ' '));

    if (/^s[iì]$/i.test(String(row[col('Subappalto SI/NO')] ?? '').trim())) {
      a.sub = true;
      const sn = str(row[col('Subappaltatore')]);
      if (sn) a.subNames.add(sn);
      a.costoSub += toNumber(row[col('Costo Totale Subappaltato')]);
    }

    const di = toISODate(row[col('Data Inizio')]);
    if (di && (a.dataInizio == null || di < a.dataInizio)) a.dataInizio = di;
    const df = toISODate(row[col('Data Fine/Consegna')]);
    if (df && (a.dataFine == null || df > a.dataFine)) a.dataFine = df;

    const bo = str(row[col('BO')]);
    if (bo) a.bdo = bo;
  }

  for (const numero_if of order) {
    const a = acc.get(numero_if)!;
    if (!a.titolo) continue;
    const rev_mesi = rev.get(numero_if) ?? Array(12).fill(0);
    const revenue_2026 = rev_mesi.reduce((s, v) => s + v, 0);
    const has_bo = a.bdo != null;

    interventi.push({
      numero_if,
      bdo: a.bdo,
      titolo: a.titolo,
      ambito: null,
      fornitore: a.fornitore || 'Intellera',
      ref_aria: null,
      ref_fornitore: null,
      importo: a.importo,
      revenue_2026,
      rev_mesi,
      modalita_if: a.modalita.size ? [...a.modalita].join(' + ') : null,
      attivazione: 'NO',
      stato: has_bo ? 'approvato' : 'non elaborato',
      has_bo,
      pdc: 'nd',
      v_apertura: 'nd',
      v_sal: 'nd',
      bef: 'nd',
      subappalto: a.sub,
      subappaltatore: [...a.subNames],
      costo_subappalto: a.costoSub,
      data_assegnazione: null,
      data_inizio: a.dataInizio,
      data_fine: a.dataFine,
      azione: null,
      note_operative: null,
      edited_manually: false,
      last_edited_at: null,
      last_edited_by: null,
    });
  }

  return { seniority, interventi };
}

function isWorkbook(x: unknown): x is Workbook {
  return Boolean(x && typeof x === 'object' && 'SheetNames' in (x as object));
}
