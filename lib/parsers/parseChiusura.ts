import type { VerbaleChiusura } from '../types';
import { readWorkbook, sheetRows, findSheet, toISODate, str, strId, isRtiIntellera } from './util';

// Parse the "REPORT Chiusura" sheet (stato verbali chiusura) into records.
// Solo le righe del RTI Intellera (colonna "Fornitore" o "Fornitore RTI")
// vengono importate.
export function parseChiusura(input: ArrayBuffer | Buffer): VerbaleChiusura[] {
  const wb = readWorkbook(input);
  const sheet = findSheet(wb, 'REPORT Chiusura', 'Chiusura');
  if (!sheet) return [];
  const out: VerbaleChiusura[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    if (!isRtiIntellera(r)) continue;
    const num_bdo = strId(r['Numero BDO']);
    if (!num_bdo && !str(r['Descrizione'])) continue;
    out.push({
      num_bdo,
      descrizione: str(r['Descrizione']),
      stato_verbale: str(r['Stato Verbale']),
      fornitore: str(r['Fornitore']),
      roi: str(r['ROI']),
      data_firma_roi: toISODate(r['Data firma ROI']),
    });
  }
  return out;
}
