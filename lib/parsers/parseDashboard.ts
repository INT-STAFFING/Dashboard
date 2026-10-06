import type { Intervento, MonthFact, Seniority } from '../types';
import {
  readWorkbook,
  sheetMatrix,
  findSheet,
  toNumber,
  toISODate,
  str,
  strId,
  normalizeFornitore,
  type Workbook,
} from './util';
import { codeFor } from './parseAggregatore';

export type DashboardResult = {
  seniority: Seniority[];
  interventi: Intervento[];
  // Monthly revenue of EVERY year the TIMELINE_REVENUE sheet has columns for
  // (only IFs found in DATI). The interventi themselves carry no months.
  mesi: MonthFact[];
};

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

// Monthly revenue per IF from the "TIMELINE_REVENUE" sheet, for every year the
// sheet covers. Layout: header on row index 1 with "Numero IF" + one date column
// per month; each data row is a single DATI line, so multiple rows share a
// Numero IF and are summed. Zero cells produce no fact (the store is sparse).
function revenueFacts(wb: Workbook): MonthFact[] {
  const sheet = findSheet(wb, 'TIMELINE_REVENUE');
  if (!sheet) return [];
  const m = sheetMatrix(wb, sheet);
  const hr = findHeaderRow(m, 'Numero IF');
  if (hr < 0) return [];

  const header = m[hr] as unknown[];
  const hi = headerIndex(header);
  const ifCol = hi['Numero IF'] ?? 0;
  // Every column whose header is a Date is one month of one year.
  const monthCols: { col: number; anno: number; mese: number }[] = [];
  header.forEach((h, i) => {
    if (h instanceof Date && !isNaN(h.getTime())) monthCols.push({ col: i, anno: h.getFullYear(), mese: h.getMonth() + 1 });
  });

  const acc = new Map<string, MonthFact>();
  for (let r = hr + 1; r < m.length; r++) {
    const row = m[r] as unknown[];
    if (!row) continue;
    const id = strId(row[ifCol]);
    if (!id) continue;
    for (const { col, anno, mese } of monthCols) {
      const v = row[col];
      if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
      const key = `${id}|${anno}|${mese}`;
      const f = acc.get(key) ?? { numero_if: id, anno, mese, revenue: 0, consuntivo: 0 };
      f.revenue += v;
      acc.set(key, f);
    }
  }
  return [...acc.values()];
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

  const facts = revenueFacts(wb);
  const seniority = seniorityFromGdl(wb);

  const interventi: Intervento[] = [];
  const datiSheet = findSheet(wb, 'DATI');
  if (!datiSheet) return { seniority, interventi, mesi: [] };

  const m = sheetMatrix(wb, datiSheet);
  const hr = findHeaderRow(m, 'Numero IF');
  if (hr < 0) return { seniority, interventi, mesi: [] };
  const hi = headerIndex(m[hr] as unknown[]);
  const col = (name: string) => hi[name];

  const acc = new Map<string, Acc>();
  const order: string[] = [];
  for (let r = hr + 1; r < m.length; r++) {
    const row = m[r] as unknown[];
    const numero_if = strId(row?.[col('Numero IF')]);
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
    if (forn) a.fornitore = normalizeFornitore(forn);

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

    const bo = strId(row[col('BO')]);
    if (bo) a.bdo = bo;
  }

  for (const numero_if of order) {
    const a = acc.get(numero_if)!;
    if (!a.titolo) continue;
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
      revenue_anno: 0,
      rev_mesi: Array(12).fill(0),
      cons_mesi: Array(12).fill(0),
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

  const ids = new Set(interventi.map((i) => i.numero_if));
  return { seniority, interventi, mesi: facts.filter((f) => ids.has(f.numero_if)) };
}

function isWorkbook(x: unknown): x is Workbook {
  return Boolean(x && typeof x === 'object' && 'SheetNames' in (x as object));
}
