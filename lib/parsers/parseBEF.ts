import type { BefRecord } from '../types';
import { readWorkbook, sheetRows, findSheet, toNumber, toISODate, str, strId } from './util';

// Solo le righe del RTI Intellera vanno importate: le altre righe del report
// (altri fornitori del raggruppamento) devono essere scartate.
const RTI_INTELLERA = 'rti 7-26 intellera';

// Parse the "REPORT Bef" sheet (fatturazione / ricezione) into BefRecord[].
export function parseBEF(input: ArrayBuffer | Buffer): BefRecord[] {
  const wb = readWorkbook(input);
  const sheet = findSheet(wb, 'REPORT Bef', 'Bef');
  if (!sheet) return [];
  const out: BefRecord[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    const fornitoreRti = str(r['Fornitore RTI']);
    if (!fornitoreRti || !fornitoreRti.toLowerCase().includes(RTI_INTELLERA)) continue;
    const num_bdo = strId(r['Numero BDO']);
    if (!num_bdo && !str(r['Descrizione'])) continue;
    out.push({
      num_bdo,
      descrizione: str(r['Descrizione']),
      periodo_competenza: str(r['Periodo Competenza']) ?? str(r['Mese competenza Verbale']),
      fornitore_reale: str(r['Fornitore Reale']) ?? str(r['Fornitore RTI']),
      importo_ricezione: toNumber(r['Importo Ricezione']),
      num_fattura: str(r['Numero Fattura']),
      data_fattura: toISODate(r['Data Fattura']),
      data_pagamento: toISODate(r['Data Pagamento']),
    });
  }
  return out;
}
