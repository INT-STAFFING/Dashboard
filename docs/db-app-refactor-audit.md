# Audit refactor DB ↔ App — Dashboard ARIA SISS L2

Tracking dei singoli interventi (`R-#`) individuati per allineare i valori
persistiti su DB al domain model applicativo. Ogni sezione documenta cosa è
stato verificato, cosa è stato cambiato (o perché non si è proceduto) e lo
stato finale.

## R-8 — Valori doc-status (`pdc` / `v_apertura` / `v_sal` / `bef_status`)

**Stato: ✅ Completato**

### Verifica vincoli di retrocompatibilità

- **Import Excel**: `lib/parsers/parseIF.ts` popola questi campi tramite
  `parseDocStatus` (`lib/parsers/util.ts`), che interpreta emoji/testo del
  workbook (`✅`/`❌`/`🔄`, "OK"/"Mancante"/"In corso") e produce direttamente
  i valori di dominio `DocStatus` (`'ok' | 'ko' | 'prog' | 'nd'`). L'import
  non legge né si aspetta i valori grezzi di colonna — non c'è alcun
  accoppiamento con la rappresentazione DB.
- **Export Excel**: nessun endpoint o script nel repository genera un file
  `.xlsx` a partire dai dati del DB (`xlsx` è usato solo per `XLSX.read` in
  fase di *upload*, mai per `XLSX.write`/`book_new`). Non esiste quindi un
  export che "già circola" e che dipenda dai valori `'OK'/'Mancante'/'InCorso'/'ND'`.
- **Console admin** (`app/api/admin/db/table/[name]/route.ts` +
  `components/AdminGestione.tsx`): il visualizzatore tabelle è generico —
  esegue `SELECT *` e renderizza ogni cella con `String(valore)`, senza alcuna
  logica che confronti il contenuto con le stringhe `'OK'/'Mancante'/'InCorso'/'ND'`.
  Un cambio del valore persistito non altera il comportamento di questo
  strumento.
- **Strumenti esterni**: nessun riferimento nel codice, negli script o nella
  documentazione a consumer esterni (BI, report, integrazioni) che leggano
  queste colonne direttamente dal DB.

Conclusione: nessun vincolo di retrocompatibilità blocca l'allineamento dei
valori di colonna al domain model.

### Intervento implementato

- Rimossi `DOC_TO_DB`, `DOC_FROM_DB` e le funzioni `docToDb`/`docFromDb` da
  `lib/store.ts`. `rowToIntervento`/`interventoToRow` ora leggono/scrivono
  direttamente i valori `DocStatus` (con fallback a `'nd'` solo per righe
  legacy con colonna `NULL`).
- Aggiornato il commento di `lib/schema.ts` sulla colonna `pdc` per riflettere
  il nuovo domain (`'ok' | 'ko' | 'prog' | 'nd'`).
- Aggiunta migration di backfill `drizzle/0007_backfill_doc_status.sql`:
  ```sql
  UPDATE "interventi" SET "pdc" = CASE "pdc"
    WHEN 'OK' THEN 'ok'
    WHEN 'Mancante' THEN 'ko'
    WHEN 'InCorso' THEN 'prog'
    WHEN 'ND' THEN 'nd'
    ELSE 'nd'
  END
  WHERE "pdc" IS NULL OR "pdc" NOT IN ('ok', 'ko', 'prog', 'nd');
  -- stessa logica per v_apertura, v_sal, bef_status
  ```
  (converte anche eventuali `NULL` o valori inattesi in `'nd'`, coerente con
  il fallback già applicato lato applicativo).
- Migration verificata su un database Postgres locale isolato con una copia
  di dati rappresentativa (valori legacy `'OK'/'Mancante'/'InCorso'/'ND'`,
  righe con colonne `NULL`, righe già in formato `DocStatus`, e un valore
  spurio non riconosciuto): il backfill ha prodotto in tutti i casi il valore
  `DocStatus` atteso, senza toccare le righe già conformi.

### Criteri di accettazione

- [x] Nessuna mappa di traduzione residua in `lib/store.ts` per questi campi;
      i valori in colonna coincidono con `DocStatus`.
- [x] Migration di backfill verificata su una copia dei dati esistenti prima
      di applicarla in produzione.
- [x] (n/a — implementato) Motivazione di non-implementazione non necessaria.

**Nota per il deploy**: la migration è un'`UPDATE` sui dati, non una modifica
di schema — va eseguita manualmente contro il DB Neon di produzione (es. via
`psql "$DATABASE_URL" -f drizzle/0007_backfill_doc_status.sql`) prima o subito
dopo il deploy di questa modifica applicativa. Il bootstrap DDL automatico in
`lib/db.ts` non applica le migration in `drizzle/*.sql`.
