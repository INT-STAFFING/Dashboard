import type { BefRecord } from '../types';
import {
  readWorkbook,
  sheetRows,
  sheetHeaders,
  findSheet,
  warnIfHeaderMismatch,
  looseGetter,
  toNumber,
  toISODate,
  str,
  strId,
  isRtiIntellera,
} from './util';

const EXPECTED_HEADERS = [
  'Numero BDO',
  'Descrizione',
  'Numero Linea Ordine',
  'Periodo Competenza',
  'Fornitore RTI',
  'Fornitore Reale',
  'Importo Ricezione',
  'Numero Fattura',
  'Data Fattura',
  'Data Pagamento',
];

// Parse the "REPORT Bef" sheet (fatturazione / ricezione) into BefRecord[].
//
// Le righe sono lette con `looseGetter` (match di intestazione insensibile a
// maiuscole, accenti e punteggiatura) perché da queste colonne dipendono
// direttamente i KPI "Fatturabile ad oggi" / "Fatturato emesso": una variante
// di intestazione nell'export renderebbe altrimenti l'intera colonna
// `undefined`, e ogni riga risulterebbe non fatturata senza alcun errore
// visibile.
//
// Solo le righe del RTI Intellera vanno importate: le altre righe del report
// (altri fornitori del raggruppamento) devono essere scartate.
export function parseBEF(input: ArrayBuffer | Buffer): BefRecord[] {
  const wb = readWorkbook(input);
  const sheet = findSheet(wb, 'REPORT Bef', 'Bef');
  if (!sheet) return [];
  warnIfHeaderMismatch(sheetHeaders(wb, sheet), EXPECTED_HEADERS, 'REPORT Bef');
  const out: BefRecord[] = [];
  for (const r of sheetRows(wb, sheet, 0)) {
    if (!isRtiIntellera(r)) continue;
    const g = looseGetter(r);
    const num_bdo = strId(g('Numero BDO'));
    const descrizione = str(g('Descrizione'));
    if (!num_bdo && !descrizione) continue;
    out.push({
      num_bdo,
      descrizione,
      // Identificativo ordinale della linea d'ordine (profilo/seniority), non
      // testo libero: stessa ragione di `num_fattura` sotto — va letto con
      // `strId` per non ereditare una coda decimale (es. "1.0") o, se il
      // foglio ha lasciato un formato-data sulla colonna, un timestamp.
      numero_linea_ordine: strId(g('Numero Linea Ordine')),
      periodo_competenza: str(g('Periodo Competenza', 'Mese competenza Verbale')),
      fornitore_reale: str(g('Fornitore Reale')) ?? str(g('Fornitore RTI', 'Fornitore')),
      importo_ricezione: toNumber(g('Importo Ricezione')),
      // Il numero fattura è un IDENTIFICATIVO, non testo libero: va letto con
      // `strId`. Con `str` una cella numerica a cui il foglio ha lasciato un
      // formato-data viene restituita da xlsx come Date e finirebbe salvata
      // come "Mon Jan 05 2026 00:00:00 GMT+0100 (…)" invece del numero di
      // fattura (stessa corruzione già riparata su numero_if/bdo in lib/db.ts),
      // e una cella numerica come 9000012345.0 conserverebbe la coda decimale.
      num_fattura: strId(g('Numero Fattura')),
      data_fattura: toISODate(g('Data Fattura')),
      data_pagamento: toISODate(g('Data Pagamento')),
    });
  }
  return out;
}
