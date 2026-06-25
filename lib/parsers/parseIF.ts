import type { Intervento } from '../types';
import {
  readWorkbook,
  sheetRows,
  findSheet,
  parseDocStatus,
  toNumber,
  toISODate,
  str,
  type Workbook,
} from './util';

const ATT_AMBITO = 'ATT.IMM.';

// Parse the "📋 Dettaglio IF" sheet of IF_ARIA_SISS_*.xlsx into Interventi.
// The data header is on the 2nd row (index 1); row 0 is a title banner.
export function parseIF(input: ArrayBuffer | Buffer | Workbook): Intervento[] {
  const wb = isWorkbook(input) ? input : readWorkbook(input);
  const sheet = findSheet(wb, '📋 Dettaglio IF', 'Dettaglio IF');
  if (!sheet) return [];
  const rows = sheetRows(wb, sheet, 1);

  // Optional note sheet to enrich note_operative
  const noteSheet = findSheet(wb, '📝 Note Operative', 'Note Operative');
  const notesByIf = new Map<string, string>();
  if (noteSheet) {
    for (const n of sheetRows(wb, noteSheet, 1)) {
      const id = str(n['N° IF']);
      const note = str(n['Note Operative']);
      if (id && note) notesByIf.set(id, note);
    }
  }

  const out: Intervento[] = [];
  for (const r of rows) {
    const numero_if = str(r['N° IF']);
    const titolo = str(r['Titolo Intervento']);
    if (!numero_if || !titolo) continue;

    const ambito = str(r['Ambito']);
    const statoBo = str(r['Stato BO']) || '';
    const has_bo = /bo emesso/i.test(statoBo) && !/non emesso/i.test(statoBo);
    const importo = toNumber(r['Importo (€)']);

    out.push({
      numero_if,
      bdo: str(r['N° BO']),
      titolo,
      ambito,
      fornitore: str(r['Fornitore']) || 'Intellera',
      ref_aria: str(r['Ref. ARIA']),
      ref_fornitore: str(r['Ref. Fornitore']),
      importo,
      revenue_2026: 0,
      rev_mesi: Array(12).fill(0),
      cons_mesi: Array(12).fill(0),
      modalita_if: str(r['Modalità']),
      attivazione: ambito === ATT_AMBITO ? 'SI' : 'NO',
      stato: has_bo ? 'approvato' : 'non elaborato',
      has_bo,
      pdc: parseDocStatus(r['PDC']),
      v_apertura: parseDocStatus(r['V. Apertura']),
      v_sal: parseDocStatus(r['V. SAL']),
      bef: parseDocStatus(r['BEF']),
      subappalto: false,
      subappaltatore: [],
      costo_subappalto: 0,
      data_assegnazione: null,
      data_inizio: toISODate(r['Data Inizio']),
      data_fine: toISODate(r['Data Fine']),
      azione: str(r['Azione Richiesta']),
      note_operative: notesByIf.get(numero_if) ?? null,
      edited_manually: false,
      last_edited_at: null,
      last_edited_by: null,
    });
  }
  return out;
}

function isWorkbook(x: unknown): x is Workbook {
  return Boolean(x && typeof x === 'object' && 'SheetNames' in (x as object));
}
