import type { ReportRdiRecord } from '../types';
import {
  readWorkbook,
  sheetRows,
  sheetHeaders,
  findSheet,
  warnIfHeaderMismatch,
  toISODate,
  str,
  strId,
  type Workbook,
} from './util';

const EXPECTED_HEADERS = [
  'Numero RDI',
  'Descrizione RDI',
  'Nome file PIF/IF',
  'Codifica numerica documento',
  'Stato del documento PIF/IF',
  'Divisione',
  'Centro di Costo',
  'Ultima PIF/IF Approvata',
  'Descrizione PIF/IF',
  'Data caricamento',
  'Utente caricamento doc IF',
  'Fornitore',
  'ROI',
  'Data invio ROI',
  'Data rifiuto ROI',
  'Data approvazione ROI',
];

// Sheet name used by the "REPORT Rdi" export (Richieste di Intervento). The
// workbook's first sheet is "Richiesta ..." — the data lives on the second
// sheet, whose name starts with "REPORT".
export function findReportRdiSheet(wb: Workbook): string | null {
  return findSheet(wb, 'REPORT Rdi', 'REPORT RDI');
}

// Parse the "REPORT Rdi" sheet into ReportRdiRecord[]. Accepts either a raw
// buffer or an already-read workbook (used by the content-sniffing fallback
// in lib/parsers/index.ts).
export function parseReportRdi(input: ArrayBuffer | Buffer | Workbook): ReportRdiRecord[] {
  const wb = 'SheetNames' in (input as Workbook) ? (input as Workbook) : readWorkbook(input as ArrayBuffer | Buffer);
  const sheet = findReportRdiSheet(wb);
  if (!sheet) return [];
  warnIfHeaderMismatch(sheetHeaders(wb, sheet), EXPECTED_HEADERS, 'REPORT Rdi');
  const out: ReportRdiRecord[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    const numero_rdi = strId(r['Numero RDI']);
    if (!numero_rdi) continue;
    out.push({
      numero_rdi,
      descrizione_rdi: str(r['Descrizione RDI']),
      nome_file_pif_if: str(r['Nome file PIF/IF']),
      codifica_documento: str(r['Codifica numerica documento']),
      stato_documento: str(r['Stato del documento PIF/IF']),
      divisione: str(r['Divisione']),
      centro_costo: str(r['Centro di Costo']),
      ultima_pif_approvata: str(r['Ultima PIF/IF Approvata']),
      descrizione_pif_if: str(r['Descrizione PIF/IF']),
      data_caricamento: toISODate(r['Data caricamento']),
      utente_caricamento: str(r['Utente caricamento doc IF']),
      fornitore: str(r['Fornitore']),
      roi: str(r['ROI']),
      data_invio_roi: toISODate(r['Data invio ROI']),
      data_rifiuto_roi: toISODate(r['Data rifiuto ROI']),
      data_approvazione_roi: toISODate(r['Data approvazione ROI']),
    });
  }
  return out;
}
