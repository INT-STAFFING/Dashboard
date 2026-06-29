// ---------------------------------------------------------------------------
// Regole di dominio dei codici ARIA SISS L2 (fonte: business owner del prodotto)
//
//  - IF  (Intervento di Fornitura) — 8 cifre:  AAAAXXXX
//        AAAA = anno corrente, XXXX = progressivo. Codice univoco.
//
//  - BDO (Buono d'Ordine) — 10 cifre:  AAAA33XXXX
//        AAAA = anno, "33" costante, XXXX = progressivo. Generato DOPO l'IF e
//        collegato all'IF (nei dati salvati IF e BDO sono in relazione: dal
//        BDO si risale all'IF e viceversa tramite intervento.bdo).
//
//  - BEF (rendicontazione) — 20 cifre:  AAMMBBBBBBBBBBXXXXXX
//        AA = anno di rendicontazione (es. 26), MM = mese (es. 04),
//        BBBBBBBBBB = il BDO rendicontato (10 cifre), XXXXXX = progressivo.
//        Per definizione un BEF porta SEMPRE dentro di sé il numero di BDO.
// ---------------------------------------------------------------------------

export const RE_IF = /^\d{8}$/;
export const RE_BDO = /^\d{4}33\d{4}$/;
export const RE_BEF = /^\d{20}$/;

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

export const isIfCode = (v: unknown): boolean => RE_IF.test(digits(v));
export const isBdoCode = (v: unknown): boolean => RE_BDO.test(digits(v));
export const isBefCode = (v: unknown): boolean => RE_BEF.test(digits(v));

// Estrae il BDO (10 cifre) incorporato in un codice BEF a 20 cifre
// (posizioni 5–14). Usato come fallback quando la colonna "Numero BDO" manca.
export function bdoFromBef(bef: unknown): string | null {
  const d = digits(bef);
  return d.length === 20 ? d.slice(4, 14) : null;
}
