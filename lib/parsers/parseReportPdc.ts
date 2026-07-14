import type { ReportPdcRecord } from '../types';
import {
  readWorkbook,
  sheetRows,
  sheetHeaders,
  findSheet,
  warnIfHeaderMismatch,
  toNumber,
  toISODate,
  str,
  strId,
  isRtiIntellera,
  type Workbook,
} from './util';

const EXPECTED_HEADERS = [
  'Numero BDO',
  'Posizione BDO',
  'Descrizione Posizione',
  'Importo Posizione',
  'Codice PDC',
  'Periodo PDC',
  'Data Creazione',
  'Utente caricamento',
  'Codifica numerica documento',
  'Stato della PDC',
  'Divisione',
  'Centro di Costo',
  'Fornitore RTI',
  'ROI',
  'Data invio ROI',
  'Data rifiuto ROI',
  'Data approvazione ROI',
  'Fornitore Prestazione',
  'Service line',
  'Tipo fornitura',
  'RDI',
  'Posizione RDI',
  'Subappalto',
  'Subappaltatore',
  'Costo subappalto',
];

// Sheet name used by the "REPORT Pdc" export (Prese in Carico). The
// workbook's first sheet is "Richiesta ..." — the data lives on the second
// sheet, whose name starts with "REPORT".
export function findReportPdcSheet(wb: Workbook): string | null {
  return findSheet(wb, 'REPORT Pdc', 'REPORT PDC');
}

// Parse the "REPORT Pdc" sheet into ReportPdcRecord[]. Accepts either a raw
// buffer or an already-read workbook (used by the content-sniffing fallback
// in lib/parsers/index.ts). Multiple rows per num_bdo are expected (one per
// posizione BDO x periodo di competenza) — the monthly detail behind
// Intervento.pdc. Solo le righe del RTI Intellera vengono importate.
export function parseReportPdc(input: ArrayBuffer | Buffer | Workbook): ReportPdcRecord[] {
  const wb = 'SheetNames' in (input as Workbook) ? (input as Workbook) : readWorkbook(input as ArrayBuffer | Buffer);
  const sheet = findReportPdcSheet(wb);
  if (!sheet) return [];
  warnIfHeaderMismatch(sheetHeaders(wb, sheet), EXPECTED_HEADERS, 'REPORT Pdc');
  const out: ReportPdcRecord[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    if (!isRtiIntellera(r)) continue;
    const num_bdo = strId(r['Numero BDO']);
    if (!num_bdo) continue;
    out.push({
      num_bdo,
      posizione_bdo: strId(r['Posizione BDO']),
      descrizione_posizione: str(r['Descrizione Posizione']),
      importo_posizione: r['Importo Posizione'] == null || r['Importo Posizione'] === '' ? null : toNumber(r['Importo Posizione']),
      codice_pdc: strId(r['Codice PDC']),
      periodo_pdc: str(r['Periodo PDC']),
      data_creazione: toISODate(r['Data Creazione']),
      utente_caricamento: str(r['Utente caricamento']),
      codifica_documento: str(r['Codifica numerica documento']),
      stato_pdc: str(r['Stato della PDC']),
      divisione: str(r['Divisione']),
      centro_costo: str(r['Centro di Costo']),
      fornitore_rti: str(r['Fornitore RTI']),
      roi: str(r['ROI']),
      data_invio_roi: toISODate(r['Data invio ROI']),
      data_rifiuto_roi: toISODate(r['Data rifiuto ROI']),
      data_approvazione_roi: toISODate(r['Data approvazione ROI']),
      fornitore_prestazione: str(r['Fornitore Prestazione']),
      service_line: str(r['Service line']),
      tipo_fornitura: str(r['Tipo fornitura']),
      rdi: strId(r['RDI']),
      posizione_rdi: strId(r['Posizione RDI']),
      subappalto: str(r['Subappalto']),
      subappaltatore: str(r['Subappaltatore']),
      costo_subappalto: r['Costo subappalto'] == null || r['Costo subappalto'] === '' ? null : toNumber(r['Costo subappalto']),
    });
  }
  return out;
}
