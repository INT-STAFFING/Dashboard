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

## R-9 — Normalizzazione delle 5 tabelle "REPORT/Verbali" in una tabella `documenti`

**Stato: ✅ Completato (non implementato per assenza di bisogno concreto)**

### Verifica del bisogno concreto (gate prima di qualsiasi implementazione)

Cercato in `docs/design-review.md` e `docs/user-stories.csv` (l'unico
inventario di user story del progetto, con verifica incrociata codice↔storia
per ogni riga) qualunque menzione di:
- una user story di reportistica cross-tabella su `report_bdo` / `report_rdi`
  / `verbali_apertura` / `verbali_sal` / `report_pdc`;
- una richiesta esplicita (utente, backlog, checklist FASE 4) di una vista o
  query che attraversi più di una di queste tabelle.

Nessuna delle due fonti menziona queste 5 tabelle nemmeno una volta (grep
case-insensitive su nomi tabella, "cross-tabella", "reportistica",
"normalizza", ecc. — zero risultati in `design-review.md`/`user-stories.csv`).
La checklist FASE 4 di `design-review.md` (gate di review ufficiale del
progetto) non riporta alcun item aperto o di backlog relativo a queste
tabelle.

Ho poi verificato lo stato d'uso reale nel codice, perché l'assenza di una
user story scritta non basta a escludere un bisogno se le tabelle fossero già
lette in più punti:
- **`report_bdo`, `report_rdi`, `verbali_apertura`**: hanno solo un percorso
  di **scrittura** (`lib/reportBdoStore.ts`, `lib/reportRdiStore.ts`,
  `lib/verbaliAperturaStore.ts`, chiamati da `app/api/upload/route.ts`).
  Nessun modulo applicativo le legge: zero import dei rispettivi store fuori
  da `app/api/upload/route.ts`. Sono quindi "write-only" oggi — semplici
  snapshot delle relative esportazioni Excel, consultabili solo via la
  console admin generica (`/api/admin/db/table/[name]`).
- **`report_pdc`, `verbali_sal`**: hanno un percorso di lettura, ma è un
  singolo `SELECT ... WHERE num_bdo = ?` per tabella, eseguito in parallelo
  (non un join) da un solo endpoint, `app/api/interventi/[num_if]/monthly/route.ts`
  (consumato da `components/panels/DettaglioIFPanel.tsx`). Non esiste oggi
  alcuna query che attraversi più di una di queste 5 tabelle nello stesso
  filtro/proiezione, quindi non c'è una "query cross-report attualmente
  impossibile" da sbloccare.

**Conclusione: il bisogno concreto richiesto dal gate non è confermato.** Non
si procede con la progettazione/migrazione della tabella normalizzata
`documenti` + tabelle di dettaglio per tipo, né con la riscrittura dei 5
store, di `app/api/upload/route.ts` e dei pannelli in `components/panels/`:
sarebbe un refactor speculativo (5 tabelle da migrare, 6+ moduli da
riscrivere, rischio di regressione sull'upload) per un caso d'uso che non è
mai stato richiesto e che oggi non ha nemmeno una lettura cross-tabella da
sostituire.

### Percorso futuro (se il bisogno emergerà)

Se in futuro emergerà una user story reale (es. "voglio vedere in un'unica
vista lo stato ROI/verbale di un BDO su Apertura+SAL+PDC+RDI+BDO"), il design
proposto nel goal resta valido come punto di partenza: tabella `documenti`
con le colonne comuni (`id, tipo, num_bdo, stato_verbale, roi,
data_invio_roi, data_approvazione_roi, data_rifiuto_roi, divisione,
centro_costo, fornitore, codifica_documento, utente_caricamento,
updated_at`) più tabelle di dettaglio per tipo per i campi non condivisi
(es. `conforme`/`criticita` solo per SAL). A quel punto andrebbero comunque
soddisfatti gli altri criteri di accettazione di questo item (migrazione
senza perdita di dati con conteggio righe prima/dopo, aggiornamento di tutti
i punti di lettura/scrittura elencati).

### Criteri di accettazione

- [x] Bisogno reale verificato **prima** di iniziare l'implementazione
      (riferimento: assenza di riscontro in `docs/design-review.md` e
      `docs/user-stories.csv`, e assenza di letture cross-tabella nel
      codice attuale — vedi sopra). Esito: bisogno non confermato.
- [x] (n/a — non implementato) Nessuna query cross-report da sostituire.
- [x] (n/a — non implementato) Nessuna migration dati da verificare.
- [x] (n/a — non implementato) Nessun punto di lettura/scrittura da
      aggiornare.
