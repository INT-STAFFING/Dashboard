import type { VerbaleAperturaRecord } from '../types';
import {
  readWorkbook,
  sheetRows,
  sheetHeaders,
  findSheet,
  warnIfHeaderMismatch,
  toISODate,
  str,
  strId,
  isRtiIntellera,
  type Workbook,
} from './util';

const EXPECTED_HEADERS = [
  'Numero BDO',
  'Descrizione',
  'Nome del file',
  'Codifica numerica documento',
  'Stato Verbale',
  'Periodo competenza',
  'Divisione',
  'Centro di Costo',
  'Fornitore',
  'Utente Caricamento Fornitore',
  'Data firma fornitore',
  'ROI',
  'Data inserimento verbale ROI ma non sottomesso',
  'Data sottomissione verbale ROI al fornitore',
  'Data firma ROI',
  'Data rifiuto ROI',
  'Data invio ROI',
];

// Sheet name used by the "REPORT Apertura" export (verbali di apertura). The
// workbook's first sheet is "Richiesta ..." — the data lives on the second
// sheet, whose name starts with "REPORT".
export function findVerbaliAperturaSheet(wb: Workbook): string | null {
  return findSheet(wb, 'REPORT Apertura', 'REPORT APERTURA');
}

// Parse the "REPORT Apertura" sheet into VerbaleAperturaRecord[]. Accepts
// either a raw buffer or an already-read workbook (used by the
// content-sniffing fallback in lib/parsers/index.ts). Solo le righe del RTI
// Intellera (colonna "Fornitore" o "Fornitore RTI") vengono importate.
export function parseVerbaliApertura(
  input: ArrayBuffer | Buffer | Workbook,
): VerbaleAperturaRecord[] {
  const wb = 'SheetNames' in (input as Workbook) ? (input as Workbook) : readWorkbook(input as ArrayBuffer | Buffer);
  const sheet = findVerbaliAperturaSheet(wb);
  if (!sheet) return [];
  warnIfHeaderMismatch(sheetHeaders(wb, sheet), EXPECTED_HEADERS, 'REPORT Apertura');
  const out: VerbaleAperturaRecord[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    if (!isRtiIntellera(r)) continue;
    const num_bdo = strId(r['Numero BDO']);
    if (!num_bdo) continue;
    out.push({
      num_bdo,
      descrizione: str(r['Descrizione']),
      nome_file: str(r['Nome del file']),
      codifica_documento: str(r['Codifica numerica documento']),
      stato_verbale: str(r['Stato Verbale']),
      periodo_competenza: str(r['Periodo competenza']),
      divisione: str(r['Divisione']),
      centro_costo: str(r['Centro di Costo']),
      fornitore: str(r['Fornitore']),
      utente_caricamento_fornitore: str(r['Utente Caricamento Fornitore']),
      data_firma_fornitore: toISODate(r['Data firma fornitore']),
      roi: str(r['ROI']),
      data_inserimento_verbale_non_sottomesso: toISODate(
        r['Data inserimento verbale ROI ma non sottomesso'],
      ),
      data_sottomissione_verbale_fornitore: toISODate(
        r['Data sottomissione verbale ROI al fornitore'],
      ),
      data_firma_roi: toISODate(r['Data firma ROI']),
      data_rifiuto_roi: toISODate(r['Data rifiuto ROI']),
      data_invio_roi: toISODate(r['Data invio ROI']),
    });
  }
  return out;
}
