import type { ReportBdoRecord } from '../types';
import { readWorkbook, sheetRows, findSheet, toISODate, str, type Workbook } from './util';

// Sheet name used by the "REPORT Bdo" export (workflow approvativo ROI/PMO/CTRM).
export function findReportBdoSheet(wb: Workbook): string | null {
  return findSheet(wb, 'REPORT Bdo', 'REPORT BDO');
}

// Parse the "REPORT Bdo" sheet into ReportBdoRecord[]. Accepts either a raw
// buffer or an already-read workbook (used by the content-sniffing fallback
// in lib/parsers/index.ts).
export function parseReportBdo(input: ArrayBuffer | Buffer | Workbook): ReportBdoRecord[] {
  const wb = 'SheetNames' in (input as Workbook) ? (input as Workbook) : readWorkbook(input as ArrayBuffer | Buffer);
  const sheet = findReportBdoSheet(wb);
  if (!sheet) return [];
  const out: ReportBdoRecord[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    const num_bdo = str(r['Numero BDO']);
    if (!num_bdo) continue;
    out.push({
      num_bdo,
      descrizione_bdo: str(r['Descrizione BDO']),
      nome_file_pif_if: str(r['Nome file PIF/IF']),
      descrizione_pif_if: str(r['Descrizione PIF/IF']),
      codifica_documento: str(r['Codifica numerica documento']),
      stato_documento: str(r['Stato del documento PIF/IF']),
      divisione: str(r['Divisione']),
      centro_costo: str(r['Centro di Costo']),
      ultima_pif_approvata: str(r['Ultima PIF/IF Approvata']),
      data_caricamento: toISODate(r['Data caricamento']),
      utente_caricamento: str(r['Utente caricamento doc BDO']),
      fornitore: str(r['Fornitore']),
      roi: str(r['ROI']),
      data_invio_roi: toISODate(r['Data invio ROI']),
      data_approvazione_roi: toISODate(r['Data approvazione ROI']),
      data_rifiuto_roi: toISODate(r['Data rifiuto ROI']),
      pmo: str(r['PMO']),
      data_invio_pmo: toISODate(r['Data invio PMO']),
      data_approvazione_pmo: toISODate(r['Data approvazione PMO']),
      data_rifiuto_pmo: toISODate(r['Data rifiuto PMO']),
      ctrm: str(r['CTRM']),
      data_invio_ctrm: toISODate(r['Data invio CTRM']),
      data_approvazione_ctrm: toISODate(r['Data approvazione CTRM']),
      data_rifiuto_ctrm: toISODate(r['Data rifiuto CTRM']),
      versione_corrente: str(r['Versione corrente BDO']),
      data_versione_corrente: toISODate(r['Data Versione corrente BDO']),
      data_decorrenza: toISODate(r['Data effettiva decorrenza BDO']),
    });
  }
  return out;
}
