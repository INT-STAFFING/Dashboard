import type { VerbaleSalRecord } from '../types';
import {
  readWorkbook,
  sheetRows,
  sheetHeaders,
  findSheet,
  warnIfHeaderMismatch,
  toISODate,
  str,
  strId,
  pick,
  type Workbook,
} from './util';

// The source export has a known refuso on this column ("sottimissione"
// instead of "sottomissione") — accept both spellings rather than hardcode
// only one.
const COL_DATA_SOTTOMISSIONE = [
  'Data sottomissione verbale ROI al fornitore',
  'Data sottimissione verbale ROI al fornitore',
];

const EXPECTED_HEADERS = [
  'Numero BDO',
  'Descrizione',
  'Nome file verbale SAL',
  'Codifica numerica documento',
  'Stato Verbale',
  'Periodo competenza',
  'Conforme',
  'Motivo Conformità',
  'Criticità',
  'Motivazione Criticità',
  'Livelli di Servizio Rispettati',
  'Divisione',
  'Centro di Costo',
  'Fornitore',
  'Utente Caricamento Fornitore',
  'Data firma fornitore',
  'ROI',
  'Data inserimento verbale ROI ma non sottomesso',
  ...COL_DATA_SOTTOMISSIONE,
  'Data firma ROI',
  'Data rifiuto ROI',
  'Data invio ROI',
];

// Sheet name used by the "REPORT Sal" export (verbali SAL). The workbook's
// first sheet is "Richiesta ..." — the data lives on the second sheet, whose
// name starts with "REPORT".
export function findVerbaliSalSheet(wb: Workbook): string | null {
  return findSheet(wb, 'REPORT Sal', 'REPORT SAL');
}

// Parse the "REPORT Sal" sheet into VerbaleSalRecord[]. Accepts either a raw
// buffer or an already-read workbook (used by the content-sniffing fallback
// in lib/parsers/index.ts). Multiple rows per num_bdo are expected (periodic
// SAL): every row of the sheet becomes one record, no dedup here.
export function parseVerbaliSal(input: ArrayBuffer | Buffer | Workbook): VerbaleSalRecord[] {
  const wb = 'SheetNames' in (input as Workbook) ? (input as Workbook) : readWorkbook(input as ArrayBuffer | Buffer);
  const sheet = findVerbaliSalSheet(wb);
  if (!sheet) return [];
  const headers = sheetHeaders(wb, sheet);
  // A row must satisfy at least one spelling of the "sottomissione" column,
  // so only warn about the pair when neither is present.
  const expected = EXPECTED_HEADERS.filter(
    (h) => !COL_DATA_SOTTOMISSIONE.includes(h) || headers.includes(h),
  );
  warnIfHeaderMismatch(headers, expected.length ? expected : EXPECTED_HEADERS, 'REPORT Sal');
  const out: VerbaleSalRecord[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    const num_bdo = strId(r['Numero BDO']);
    if (!num_bdo) continue;
    out.push({
      num_bdo,
      descrizione: str(r['Descrizione']),
      nome_file: str(r['Nome file verbale SAL']),
      codifica_documento: str(r['Codifica numerica documento']),
      stato_verbale: str(r['Stato Verbale']),
      periodo_competenza: str(r['Periodo competenza']),
      conforme: str(r['Conforme']),
      motivo_conformita: str(r['Motivo Conformità']),
      criticita: str(r['Criticità']),
      motivazione_criticita: str(r['Motivazione Criticità']),
      livelli_servizio_rispettati: str(r['Livelli di Servizio Rispettati']),
      divisione: str(r['Divisione']),
      centro_costo: str(r['Centro di Costo']),
      fornitore: str(r['Fornitore']),
      utente_caricamento_fornitore: str(r['Utente Caricamento Fornitore']),
      data_firma_fornitore: toISODate(r['Data firma fornitore']),
      roi: str(r['ROI']),
      data_inserimento_verbale_non_sottomesso: toISODate(
        r['Data inserimento verbale ROI ma non sottomesso'],
      ),
      data_sottomissione_verbale_fornitore: toISODate(pick(r, ...COL_DATA_SOTTOMISSIONE)),
      data_firma_roi: toISODate(r['Data firma ROI']),
      data_rifiuto_roi: toISODate(r['Data rifiuto ROI']),
      data_invio_roi: toISODate(r['Data invio ROI']),
    });
  }
  return out;
}
