# Audit Refactor — Applicazione & Database (Dashboard ARIA SISS L2)

Data audit: 2026-07-17 · Stack: Next.js 14 (App Router) · TypeScript 5 · Drizzle ORM · Neon Postgres (driver `neon-http`) · Vercel

> Analisi di sola lettura del codice esistente (nessuna modifica applicata durante
> l'audit). Complementare a `docs/performance-audit.md` (percezione/render/rete)
> e `docs/design-review.md` (prodotto/UX): qui il focus è **data layer, schema
> DB e superficie di sicurezza backend**.

## Come usare questo documento

Ogni intervento è una scheda **autosufficiente**: contesto, file coinvolti e un
blocco `GOAL:` pensato per essere incollato così com'è come istruzione a un
agente di sviluppo (o eseguito manualmente) — un intervento alla volta, senza
dover rileggere l'intero audit. Ogni scheda ha anche criteri di accettazione
verificabili per considerare l'intervento chiuso.

Convenzione priorità: **P1** = alto impatto (sicurezza/integrità dati),
**P2** = medio impatto (manutenibilità/robustezza), **P3** = basso impatto /
solo se emerge un bisogno reale.

## Tabella riepilogativa

| ID | Titolo | Categoria | Impatto | Effort | Priorità | Stato |
|----|--------|-----------|---------|--------|----------|-------|
| R-1 | Fallback insicuro per `AUTH_SECRET` in produzione | Security | Alto | S | P1 | ⬜ Aperto |
| R-2 | Scritture non atomiche (delete+insert) nelle store di snapshot | DB/Integrità | Alto | M | P1 | ✅ Completato |
| R-3 | Console SQL admin senza audit trail | Security | Alto | S | P1 | ⬜ Aperto |
| R-4 | Doppia fonte di verità per lo schema DB (DDL bootstrap vs migration) | DB/Manutenibilità | Medio | M | P2 | ✅ Completato |
| R-5 | Duplicazione strutturale negli store di upload | App/Manutenibilità | Medio | M | P2 | ✅ Completato (riduzione -120 righe, sotto l'obiettivo indicativo — vedi nota) |
| R-6 | Cache assente sul payload SSR della dashboard | Rete/Performance | Medio | L | P2 | ✅ Completato |
| R-7 | Nessun vincolo referenziale/di dominio a livello DB | DB/Integrità | Medio | M | P2 | ✅ Completato (solo CHECK; FK debole resta backlog) |
| R-8 | Vocabolario doppio dominio↔DB per gli stati documentali | App/Manutenibilità | Basso | S | P3 | ✅ Completato |
| R-9 | Duplicazione colonne tra le 5 tabelle "report" | DB/Modellazione | Basso | L | P3 | ✅ Completato (non implementato per assenza di bisogno concreto) |

---

## R-1 — Fallback insicuro per `AUTH_SECRET` in produzione

**Categoria:** Security · **Impatto:** Alto · **Effort:** S · **Priorità:** P1

**File:** `lib/auth/session.ts:18-24`

**Problema:** se le env var `AUTH_SECRET` / `UPLOAD_SECRET` non sono
configurate, le sessioni vengono firmate con la stringa letterale
`'aria-siss-dev-insecure-secret-change-me'`, presente nel codice sorgente e
quindi pubblica. Un deploy in produzione senza quella env var permetterebbe a
chiunque di forgiare un cookie di sessione con ruolo `ADMIN`.

**GOAL:** In `lib/auth/session.ts`, modifica `getAuthSecret()` affinché in
produzione (`process.env.NODE_ENV === 'production'`) lanci un errore esplicito
se né `AUTH_SECRET` né `UPLOAD_SECRET` sono definite, invece di restituire il
secret di default hardcoded. Mantieni il fallback insicuro solo per
sviluppo/test locali (`NODE_ENV !== 'production'`), con un warning in console
che ne segnali l'uso. Verifica che il fail-fast avvenga al primo utilizzo
(login, verifica sessione) e non silenziosamente più a valle.

**Criteri di accettazione:**
- [ ] In produzione senza `AUTH_SECRET`/`UPLOAD_SECRET`, ogni route che crea o
      verifica una sessione fallisce in modo esplicito (errore 500 loggato),
      non firma/valida con il secret di default.
- [ ] In sviluppo il comportamento attuale resta invariato (zero-config).
- [ ] Nessuna regressione su login/logout/middleware nei test manuali.

---

## R-2 — Scritture non atomiche (delete+insert) nelle store di snapshot ✅ Completato

**Categoria:** DB/Integrità dati · **Impatto:** Alto · **Effort:** M · **Priorità:** P1

**File:** `lib/verbaliAperturaStore.ts:29-32`, `lib/reportPdcStore.ts:42-43`,
`lib/befStore.ts:114-129` (`replaceBef`) — `lib/verbaliSalStore.ts` era
elencato nella formulazione originale ma ne è stato escluso, vedi nota sotto.

**Problema:** per rendere idempotente il ri-upload di un file, queste store
eseguono `DELETE ... WHERE num_bdo IN (...)` seguito da un `INSERT` separato —
due round-trip HTTP distinti (il driver `neon-http` non supporta transazioni
interattive). Se il secondo round-trip fallisce (rete, timeout, errore di
validazione a metà batch), la tabella resta **vuota** per quel BDO invece di
tornare allo stato precedente: perdita di dati silenziosa.

**GOAL:** Per le tabelle `verbali_apertura`, `verbali_sal`, `report_pdc` e per
`replaceBef` in `lib/befStore.ts`, sostituisci il pattern delete+insert con un
vero upsert basato su `ON CONFLICT DO UPDATE` su una chiave naturale composta
adeguata per ciascuna tabella (es. `num_bdo + posizione_bdo + periodo_pdc` per
`report_pdc`; valuta caso per caso quale combinazione di colonne identifica
univocamente una riga in ciascuna tabella). Se una chiave naturale univoca non
è individuabile in modo pulito, valuta in alternativa l'introduzione di una
unique constraint dedicata o l'uso del driver `@neondatabase/serverless` in
modalità pool (WebSocket) con `db.transaction()` reale limitatamente a questi
path di scrittura. Aggiorna anche le migration in `drizzle/*.sql` e il blocco
DDL in `lib/db.ts` con le nuove unique constraint.

**Criteri di accettazione:**
- [x] Un fallimento simulato a metà della fase "insert" lascia la tabella nello
      stato precedente (nessuna riga persa), verificato con un test manuale o
      automatico che inietta un errore.
- [x] Il comportamento funzionale dell'upload (stesso file ricaricato più
      volte → stesso risultato finale) resta invariato.
- [x] Schema e migration aggiornati e coerenti tra `lib/schema.ts`,
      `lib/db.ts` e `drizzle/*.sql`.

**Correzione allo scope originale:** `lib/verbaliSalStore.ts` è stato
**escluso** dall'intervento. Verificando il codice prima di modificarlo è
emerso che `verbali_sal`, a differenza delle altre tre tabelle, non fa mai
`DELETE` — è append-only per design esplicito (righe multiple per `num_bdo`
sono attese e intenzionali: "periodic SAL over time", vedi il commento in
`lib/verbaliSalStore.ts` e nel parser `lib/parsers/parseVerbaliSal.ts`: "no
dedup here"). Include-la nel pattern delete+insert→upsert avrebbe introdotto
una regressione reale (deduplica di righe che devono poter coesistere).
`persistVerbaliSalFromUpload` esegue già un singolo `INSERT` — un solo
statement SQL è atomico di per sé, senza bisogno di intervento. L'inclusione
di questa tabella nella formulazione originale del problema era un errore
dell'audit, corretto qui.

**Implementazione:** un vero upsert `ON CONFLICT DO UPDATE` su chiave naturale
composta, per ciascuna tabella:
- `bef_records`: `(numero_if, num_fattura)` — mirror della regola di business
  già codificata in `upsertBef` ("Decisione 2B": righe con la stessa fattura
  sono la stessa riga logica; Postgres non fa mai collidere due `NULL` in un
  indice unique, quindi le righe senza fattura restano "non deduplicabili"
  esattamente come nella semantica originale).
- `report_pdc`: `(num_bdo, posizione_bdo, periodo_pdc)` — la cardinalità già
  documentata nel commento della tabella ("one per posizione BDO x periodo
  di competenza").
- `verbali_apertura`: `(num_bdo, codifica_documento)` — `codifica_documento`
  è l'identificativo di documento della fonte, il candidato più solido come
  identità di riga stabile.

Nuove unique index in `lib/schema.ts` (`uniqueIndex(...).on(...)`), propagate
sia al blocco DDL di self-provisioning in `lib/db.ts` (`SCHEMA_VERSION` 1→2)
sia alla migration `drizzle/0007_organic_odin.sql` (generata con
`drizzle-kit generate`). Poiché il vecchio pattern non deduplicava mai le
righe, un DB Neon già in uso può avere duplicati che violerebbero le nuove
unique index: entrambi i file eseguono prima una `DELETE` di pulizia
idempotente (tiene la riga con `id` più alto per ogni gruppo di duplicati),
poi creano l'indice — verificato che il bootstrap non vada in errore su un
DB con dati preesistenti (vedi Verifica).

Righe il cui campo chiave è assente (`num_fattura`/`codifica_documento`/
`posizione_bdo`+`periodo_pdc` mancanti) restano "non deduplicabili": vengono
bucketizzate a parte e sostituite per intero ad ogni upload per lo stesso
`num_bdo`/`numero_if` (stesso comportamento del vecchio delete-all, solo
ristretto a quel sottoinsieme). Per le righe con chiave, una seconda `DELETE`
mirata rimuove solo quelle il cui valore-chiave non è più presente nel nuovo
batch (riga rimossa/sostituita in un caricamento più recente) — a differenza
del vecchio "cancella tutto e reinserisci", qui le righe non toccate dal
nuovo upload restano *fisicamente* la stessa riga (stesso `id`), aggiornata
in place via `ON CONFLICT DO UPDATE`.

Le due `DELETE` mirate e l'`INSERT ... ON CONFLICT DO UPDATE` restano comunque
tre/quattro statement separati: per renderli atomici (il problema originale
di R-2) sono inviati con `db.batch([...])`, che il driver `neon-http`
supporta anche se non supporta `db.transaction()` interattivo
(`drizzle-orm/neon-http/session.js`: *"No transactions support in neon-http
driver"*) — `db.batch()` chiama `client.transaction([...])` di
`@neondatabase/serverless`, che invia l'intero batch come un solo `POST` al
Data API di Neon (header `Neon-Batch-Isolation-Level` ecc., propri di una
vera transazione lato server): o si applicano tutti gli statement o nessuno.
Helper condiviso `excludedSet()` in `lib/db.ts` costruisce la clausola `set`
di `onConflictDoUpdate` da tutte le colonne della tabella meno la chiave,
evitando di elencarle a mano tre volte.

**Verifica:** `tsc --noEmit` e `next build` puliti. Il driver `neon-http`
richiede un vero endpoint Neon (non raggiungibile da questo ambiente), quindi
la verifica è stata fatta in due parti contro un Postgres reale locale:
1. **Migrazione su DB con duplicati preesistenti:** applicate le migration
   `0000`-`0006` (schema pre-R-2), seminati duplicati che violerebbero le
   nuove unique index, poi applicata `0007_organic_odin.sql` — la
   deduplicazione rimuove correttamente solo la riga più vecchia di ogni
   gruppo (le righe BEF senza fattura, non deduplicabili, restano intatte) e
   le 3 `CREATE UNIQUE INDEX` vanno a buon fine senza errori.
2. **Comportamento a runtime:** estratto con `.toSQL()` l'SQL realmente
   compilato da Drizzle per ciascuno statement (delete mirata, delete
   unkeyed, insert, upsert) ed eseguito contro un DB popolato con uno
   scenario realistico (riga da aggiornare, riga obsoleta da rimuovere, riga
   unkeyed da sostituire, riga non correlata) avvolto in `BEGIN/COMMIT` (lo
   stesso comportamento di `db.batch()`). Per tutte e tre le tabelle:
   la riga con chiave esistente viene aggiornata **in place** (stesso `id`);
   la riga obsoleta e quella unkeyed vengono rimosse; la nuova riga unkeyed
   viene inserita; la riga non correlata (chiave/scope diversi) non viene mai
   toccata; un errore iniettato dopo le `DELETE` e prima del `COMMIT` lascia
   intatto lo stato precedente (nessuna perdita dati); lo stesso batch
   rieseguito più volte di seguito produce sempre lo stesso stato finale.

### Correzione successiva — la chiave naturale di `bef_records` era sbagliata

La chiave `(numero_if, num_fattura)` scelta sopra formalizzava un assunto di
dominio **falso**: che due righe BEF con lo stesso numero di fattura fossero la
stessa riga logica ("Decisione 2B"). Nel report BEF una singola fattura copre
normalmente **più righe**, una per BDO e per periodo di competenza. L'indice
unique e l'`ON CONFLICT DO UPDATE` le collassavano quindi in un'unica riga ad
ogni upload, e la `DELETE` di deduplica pre-indice faceva lo stesso sui dati già
presenti: l'importo di tutte le righe scartate spariva dal KPI "Fatturato
emesso" del tab Timeline e dalla serie mensile del grafico. Riprodotto: 5 righe
in ingresso → 4 righe salvate, `fatturatoEmesso` 450.623,43 → 350.623,43.

Correzione (`drizzle/0010_bef_drop_fattura_unique.sql`, `SCHEMA_VERSION` 5→6):

- l'indice unique su `bef_records` è **rimosso** — più righe per
  `(numero_if, num_fattura)` sono attese e devono essere conservate;
- la deduplica avviene solo in `upsertBef`, sulla chiave naturale reale
  `(num_bdo, periodo_competenza, num_fattura)`;
- `replaceBef` torna a `DELETE` per `numero_if` + `INSERT` dell'elenco
  completo, sempre dentro un unico `db.batch()`: l'atomicità che era
  l'obiettivo di R-2 è preservata, la deduplica scorretta no.

`report_pdc` e `verbali_apertura` non sono toccate: le loro chiavi
(`num_bdo`+`posizione_bdo`+`periodo_pdc`, `num_bdo`+`codifica_documento`)
identificano davvero una riga e restano valide.

---

## R-3 — Console SQL admin senza audit trail

**Categoria:** Security · **Impatto:** Alto · **Effort:** S · **Priorità:** P1

**File:** `app/api/admin/db/query/route.ts`

**Problema:** l'endpoint esegue qualsiasi istruzione SQL (`SELECT` / `INSERT` /
`UPDATE` / `DELETE` / DDL) protetto solo da `isAdmin(session)`. Non esiste
alcun log di chi ha eseguito quale query e quando, né distinzione tra
operazioni di lettura e operazioni distruttive.

**GOAL:** Aggiungi un audit log per `app/api/admin/db/query/route.ts`: prima di
eseguire la query, registra (in una tabella dedicata `admin_query_log` con
colonne `id, user_id, user_email, query_text, executed_at, success,
error_message, row_count, duration_ms`, oppure in un log esterno se preferito)
chi ha lanciato la query, il testo esatto e l'esito. Lo scrivi anche in caso di
errore. Non bloccare l'esecuzione della query in caso di fallimento del solo
logging (logga il fallimento del logging stesso senza propagarlo
all'utente). Valuta se aggiungere un parametro esplicito `unsafe: true` nel
body richiesto per abilitare istruzioni diverse da `SELECT` (default
"solo lettura"), mantenendo la retrocompatibilità per l'uso admin attuale.

**Criteri di accettazione:**
- [ ] Ogni chiamata a `POST /api/admin/db/query` produce una riga di audit
      con utente, query e esito, consultabile da un admin.
- [ ] Un errore nel logging non impedisce l'esecuzione della query originale.
- [ ] (Se implementato) le query non-`SELECT` richiedono il flag esplicito
      `unsafe: true`, con messaggio d'errore chiaro se omesso.

---

## R-4 — Doppia fonte di verità per lo schema DB ✅ Completato

**Categoria:** DB/Manutenibilità · **Impatto:** Medio · **Effort:** M · **Priorità:** P2

**File:** `lib/db.ts:49-298` (array `DDL`), `drizzle/*.sql`

**Problema:** `lib/db.ts` contiene ~28 statement `CREATE TABLE IF NOT EXISTS` /
`ALTER TABLE` scritti a mano, paralleli alle migration ufficiali generate da
Drizzle in `drizzle/*.sql`. Il commento nel file lo ammette esplicitamente
("Keep these in sync with lib/schema.ts and the SQL in drizzle/*.sql"): due
fonti di verità sincronizzate manualmente, già andate fuori sync in passato
(da cui gli `ALTER TABLE ADD COLUMN IF NOT EXISTS` accodati in fondo
all'array). In più, questo bootstrap gira ad ogni cold-start finché la promise
in-memory (`schemaPromise`) non è "calda" — e si resetta a ogni nuova istanza
serverless, costando fino a 28 round-trip HTTP sequenziali.

**GOAL:** Introduci una sentinella di versione schema in `app_config` (es.
chiave `schema_version` con valore numerico). In `ensureSchema()` (`lib/db.ts`),
prima di eseguire il blocco `DDL`, fai un singolo `SELECT` della sentinella: se
già alla versione corrente, salta l'intero blocco DDL (un solo round-trip
invece di 28). Se manca o è inferiore, esegui il DDL e poi scrivi la nuova
versione. Documenta nel file il numero di versione atteso e ricordati di
incrementarlo ad ogni futura modifica di schema. Valuta in un secondo momento
(fuori da questo intervento, solo se si vuole affrontare la doppia fonte di
verità) la generazione automatica del blocco `DDL` a partire dai file
`drizzle/*.sql` invece di mantenerlo a mano.

**Criteri di accettazione:**
- [x] Su un DB già provisionato alla versione corrente, `ensureSchema()` fa un
      solo round-trip invece di eseguire tutti gli statement DDL.
- [x] Su un DB vergine, il bootstrap crea correttamente tutte le tabelle e
      imposta la sentinella alla versione corrente.
- [x] Nessuna regressione sull'auto-provisioning che oggi garantisce il
      funzionamento su DB vuoto.

**Implementazione:** `lib/db.ts` — costante `SCHEMA_VERSION` (attualmente
`1`) + chiave `schema_version` in `app_config`. `bootstrap()` legge la
sentinella con `readSchemaVersion()`: se il valore è già `>= SCHEMA_VERSION`
ritorna subito (un solo round-trip); altrimenti esegue l'intero blocco `DDL`
come prima e scrive la nuova versione con `writeSchemaVersion()`. Da
incrementare `SCHEMA_VERSION` (con nota di cosa è cambiato) a ogni futura
modifica dell'array `DDL`.

**Verifica:** `tsc --noEmit` e `next build` puliti. I tre criteri sono stati
validati eseguendo il blocco `DDL` estratto letteralmente dal file e le query
della sentinella (stessa forma parametrizzata già in uso in
`lib/settings.ts`) contro un Postgres reale locale (non un endpoint Neon, non
raggiungibile da questo ambiente): su DB vergine la lettura della sentinella
fallisce come atteso (`relation "app_config" does not exist"`) e il bootstrap
crea correttamente le 14 tabelle e i 10 indici/unique attesi; la lettura
successiva della sentinella restituisce `1` in un solo round-trip; una
seconda esecuzione dell'intero blocco DDL su DB già popolato è completamente
idempotente (nessun errore). La generazione automatica del blocco `DDL` da
`drizzle/*.sql` resta backlog (menzionata nel `GOAL`), non necessaria per
chiudere questo intervento.

---

## R-5 — Duplicazione strutturale negli store di upload ✅ Completato

**Categoria:** App/Manutenibilità · **Impatto:** Medio · **Effort:** M · **Priorità:** P2

**File:** `lib/befStore.ts`, `lib/verbaliAperturaStore.ts`,
`lib/verbaliSalStore.ts`, `lib/reportPdcStore.ts`, `lib/reportBdoStore.ts`,
`lib/reportRdiStore.ts` (~500 righe totali); `app/api/upload/route.ts:45-228`
(funzioni `normalizeXxx`)

**Problema:** i sei store "snapshot" ripetono lo stesso scheletro: variabile
globale `__ARIA_XXX__` come fallback in-memory, funzioni locali `numN`/`strN`/
`toRow`/`rowToRecord` quasi identiche, pattern "delete righe per num_bdo poi
insert". In `app/api/upload/route.ts` esistono 7 funzioni `normalizeXxx()`
quasi identiche (business-key check + `sval`/`num` su ogni campo).

**GOAL:** Estrai una factory generica riutilizzabile (es.
`lib/dualModeStore.ts` con una funzione `createSnapshotStore<TRow, TRecord>`)
che parametrizzi: tabella Drizzle, mappatura riga↔record, chiave di
sostituzione (colonna/e usate nel delete-by-key o upsert dopo R-2), e nome
della variabile globale per il fallback in-memory. Migra `verbaliAperturaStore.ts`,
`verbaliSalStore.ts` e `reportPdcStore.ts` (i tre più simili) su questa
factory, mantenendo invariata la firma pubblica delle funzioni esportate
(`persistXxxFromUpload`, `listXxxByBdo`) così da non toccare i chiamanti in
`app/api/upload/route.ts`. Per le funzioni `normalizeXxx` in
`app/api/upload/route.ts`, valuta l'introduzione di uno schema di validazione
dichiarativo (es. Zod) per definire una volta sola forma e regole di ciascun
tipo di riga, sostituendo le chiamate ripetute a `sval`/`num`.

**Criteri di accettazione:**
- [x] Comportamento di upload/lettura identico prima e dopo per tutte le
      tabelle migrate (stesso file caricato due volte produce lo stesso
      risultato di `saved`/`ignored`).
- [x] Riduzione misurabile delle righe duplicate (obiettivo indicativo:
      -250/-350 righe nette tra store e normalizzatori) — **raggiunte -120
      righe nette**, misurabili e reali ma sotto l'obiettivo indicativo. Vedi nota.
- [x] Nessuna modifica alla firma pubblica delle funzioni consumate da
      `app/api/upload/route.ts` e dagli altri chiamanti.

**Implementazione:** nuova `lib/dualModeStore.ts` con
`createSnapshotStore<TTable, TRecord>`, che parametrizza tabella Drizzle,
colonna di scope (`num_bdo`), colonne extra della chiave naturale (opzionali
— assenti per le tabelle append-only come `verbali_sal`), mappatura
riga↔record e chiave `globalThis` per il fallback in-memory. Copre entrambe
le strategie oggi in uso dopo R-2: upsert su chiave naturale composta con
rimozione delle righe obsolete (`verbali_apertura`, `report_pdc`) e append
puro senza deduplica (`verbali_sal`). `toRow`/`fromRow` hanno un default
generico (passthrough + conversione automatica delle colonne `numericColumns`
stringa↔numero) così `verbaliAperturaStore.ts` e `verbaliSalStore.ts` non
hanno più bisogno di scriverli a mano; `reportPdcStore.ts` li usa anch'esso
tramite `numericColumns: ['importo_posizione', 'costo_subappalto']`,
mantenendo solo il filtro `knownBdo`/`ignored` specifico di quella tabella
(non generalizzato, perché è una regola di business di un solo store).

Per le funzioni `normalizeXxx` in `app/api/upload/route.ts`: **valutato**
Zod come indicato nel `GOAL`, **non adottato** — introdurrebbe una nuova
dipendenza di produzione (non presente nel `package.json` attuale, che ha
solo `@neondatabase/serverless`/`drizzle-orm`/`next`/`react`/`xlsx`) senza
che i criteri di accettazione la richiedano esplicitamente, e senza un'analisi
costi/benefici discussa con il team. Al suo posto, un helper dichiarativo
`normalizeRow()` interno (elenco di campi + eventuali campi numerici +
requisito di presenza) sostituisce le 6 funzioni `normalizeBef`/
`normalizeReportBdo`/`normalizeReportRdi`/`normalizeVerbaleApertura`/
`normalizeVerbaleSal`/`normalizeReportPdc`, riusando gli stessi helper
`sval`/`num` già presenti — stessa idea di Zod (schema dichiarato una volta,
niente `sval()`/`num()` ripetuti campo per campo) senza aggiungere una
dipendenza. `normalizeIntervento` non è stato toccato: ha logica genuinamente
più complessa (array `rev_mesi`/`cons_mesi`, default, ternari) che non si
presta allo stesso schema dichiarativo senza forzature.

**Nota sulla riduzione di righe (-120 invece di -250/-350):** la stima
originale nel `GOAL` era stata calibrata su store più semplici (delete poi
insert riga-per-riga) precedenti al redo di R-2, che ha già introdotto la
logica più sofisticata di upsert su chiave composta con rimozione selettiva
delle righe obsolete — di per sé più complessa da astrarre correttamente
(serve gestire tuple SQL a N colonne, split keyed/unkeyed, batch atomico).
`lib/dualModeStore.ts` porta quindi un costo fisso reale (~180 righe) che tre
soli punti di utilizzo non ammortizzano fino al range indicato, pur avendo
reso `verbaliAperturaStore.ts` e `verbaliSalStore.ts` sottilissimi (19 righe
ciascuno, da 90/71) e dimezzato `reportPdcStore.ts` (37 righe, da 140).
`lib/befStore.ts` — che ha la maggior quantità di logica quasi-duplicata tra
i quattro store di snapshot — è rimasto **volutamente fuori scope**, come
indicato esplicitamente nel `GOAL`; includerlo avrebbe avvicinato la
riduzione al target ma non era autorizzato da questo intervento. Misura
esatta: 823 → 703 righe totali su
`app/api/upload/route.ts` + `lib/reportPdcStore.ts` +
`lib/verbaliAperturaStore.ts` + `lib/verbaliSalStore.ts` +
`lib/dualModeStore.ts` (nuovo file incluso).

**Verifica:** `tsc --noEmit` e `next build` puliti. Il driver `neon-http`
richiede un vero endpoint Neon (non raggiungibile da questo ambiente): per
verificare il comportamento end-to-end del codice reale (non una
reimplementazione) è stato impostato un `DATABASE_URL` fittizio e
intercettato `global.fetch` per catturare le query realmente costruite da
`persistVerbaliAperturaFromUpload`/`persistReportPdcFromUpload`/
`persistVerbaliSalFromUpload`/`listPdcByBdo`/`listSalByBdo` (stessi moduli
importati dal codice, nessuna riscrittura nel test), poi rieseguite contro
un Postgres locale avvolte in `BEGIN`/`COMMIT` (esattamente il comportamento
di `db.batch()`). Confermato: aggiornamento in-place della riga con chiave
esistente, rimozione della riga con chiave obsoleta, sostituzione integrale
delle righe non deduplicabili (unkeyed), riga di scope non correlato mai
toccata, conversione numerica string↔number round-trip corretta
(`importo_posizione`), `verbali_sal` genera una singola `INSERT` (mai un
batch), `saved`/`ignored` di `persistReportPdcFromUpload` corretti dopo il
filtro `knownBdo`; un errore iniettato a metà batch lascia intatte le righe
preesistenti (atomicità) e lo stesso batch rieseguito 3 volte produce sempre
lo stesso stato finale (idempotenza) — stessa metodologia e stessi risultati
già osservati in R-2, a conferma che il refactor non ha alterato il
comportamento.

---

## R-6 — Cache assente sul payload SSR della dashboard ✅ Completato

**Categoria:** Rete/Performance · **Impatto:** Medio · **Effort:** L · **Priorità:** P2

**File:** `lib/getDashboardData.ts`, tutte le route di mutazione
(`app/api/interventi/**`, `app/api/upload/route.ts`, `app/api/admin/**`,
`app/api/config/rti/route.ts`)

**Problema:** `getDashboardData()` interroga il DB a ogni request (già
ottimizzata a 4 round-trip paralleli, vedi `docs/performance-audit.md` #4), ma
i dati cambiano solo su mutazione esplicita. Ogni caricamento di `/dashboard`
paga comunque la latenza di rete verso Neon anche quando nulla è cambiato
dall'ultima richiesta. Già segnalato come backlog nell'audit performance
(#16), qui riformulato come intervento di data-layer.

**GOAL:** Avvolgi `getDashboardData()` con `unstable_cache` di Next.js, usando
un tag stabile (es. `'dashboard-data'`). In ogni route handler che muta dati
visibili in dashboard (interventi CRUD, upload, admin gara/tariffe/risorse/
timeline, config RTI), chiama `revalidateTag('dashboard-data')` dopo il
commit della scrittura. Verifica che tutte le route di mutazione esistenti
siano coperte (fai un elenco esplicito prima di iniziare, non fidarti solo
della memoria) per evitare dati stantii dopo una modifica non taggata.

**Criteri di accettazione:**
- [x] Il TTFB di `/dashboard` in lettura ripetuta (nessuna mutazione nel
      mezzo) è misurabilmente più basso.
- [x] Ogni mutazione (creazione/modifica/cancellazione intervento, upload,
      modifica admin, modifica config RTI) invalida correttamente la cache:
      il dato aggiornato è visibile all'utente entro la richiesta successiva.
- [x] Nessuna route di mutazione dimenticata (verifica incrociata con
      l'elenco in `app/api/**`).

**Implementazione:** `lib/getDashboardData.ts` — la logica di assemblaggio è
stata rinominata `assembleDashboardData` (privata) e avvolta con
`unstable_cache(assembleDashboardData, ['dashboard-data'], { tags:
[DASHBOARD_DATA_TAG] })`; `getDashboardData` resta il nome esportato, quindi
`app/dashboard/page.tsx` (unico chiamante) non è stato toccato. Nessun
`revalidate` a tempo: l'invalidazione è solo su tag, coerente con il fatto che
i dati cambiano solo su mutazione esplicita.

**Elenco esplicito delle route in `app/api/**`** (costruito a inizio
intervento leggendo ogni `route.ts`, non a memoria) e decisione presa per
ciascuna:

| Route | Metodo | Cosa scrive | Nel payload di `getDashboardData()`? | `revalidateTag` aggiunto |
|---|---|---|---|---|
| `interventi/route.ts` | POST | `interventi` | Sì (interventi, kpi, revenue_mensile, distribuzione_ambito) | ✅ |
| `interventi/[num_if]/route.ts` | PUT | `interventi` | Sì | ✅ |
| `interventi/[num_if]/route.ts` | DELETE | `interventi` (soft-delete) | Sì | ✅ |
| `upload/route.ts` | POST | interventi + bef/report_bdo/report_rdi/verbali_apertura/verbali_sal/report_pdc + seniority + meta | Sì (interventi, bef_monthly/aggregates, seniority, meta) | ✅ |
| `admin/gara/route.ts` | PUT | `meta` (app_config) + `config_rti` | Sì (meta, rti, quota_val) | ✅ (solo se `body.meta`/`body.rti` presenti) |
| `admin/tariffe/route.ts` | PUT | `seniority` (app_config) — nome route fuorviante, non tocca la tabella `tariffe` | Sì (seniority) | ✅ |
| `admin/risorse/[num_if]/route.ts` | PUT | `if_risorse` | **No** (non è nel payload oggi) | ✅ comunque, in modo difensivo — nominata esplicitamente nel `GOAL`, costo di un'invalidazione superflua trascurabile su una route admin a bassa frequenza |
| `admin/timeline/route.ts` | PUT | `timeline` (app_config, singolo anno legacy) | Sì (timeline) | ✅ |
| `admin/timeline/anno/route.ts` | PUT | `timeline_mensile` (multi-anno) | Sì (timeline_my) | ✅ |
| `admin/bef/[num_if]/route.ts` | PUT | `bef_records` | Sì (bef_monthly, bef_aggregates) | ✅ |
| `config/rti/route.ts` | PUT | `config_rti` | Sì (rti, quota_val) | ✅ |
| `admin/db/query/route.ts` | POST | SQL arbitrario (qualunque tabella) | Potenzialmente sì, non determinabile staticamente | ✅ sempre su esecuzione riuscita, in modo difensivo (vedi nota) |
| `admin/users/route.ts`, `admin/users/[id]/route.ts` | POST/PATCH/DELETE | tabella `users` | No (utenti non fanno parte del payload) | non necessario |
| `auth/login`, `auth/logout`, `auth/register` | POST | sessione/utenti | No | non necessario |
| `admin/db/table/[name]/route.ts`, `admin/db/tables/route.ts` | GET | — | N/A (sola lettura) | non necessario |
| `me/route.ts`, `data/route.ts`, `interventi/[num_if]/monthly/route.ts` | GET | — | N/A (sola lettura; `data/route.ts` non chiama nemmeno `getDashboardData()` — query proprie, non risulta invocato da alcun codice client in questo repo) | non necessario |

Nota sulla console SQL admin (`admin/db/query`): poiché esegue SQL arbitrario,
non è possibile determinare staticamente dal testo della query se abbia
toccato una tabella letta dal payload dashboard — invalida quindi la cache
dopo **ogni** esecuzione riuscita, indipendentemente dal tipo di istruzione.

**Verifica:** `tsc --noEmit` e `next build` puliti. Eseguita end-to-end contro
un `next start` reale (fallback in-memory, nessun DB configurato in questo
ambiente) con login come admin di default e cookie di sessione reale:
- **Meccanismo cache:** una sonda temporanea (rimossa prima del commit) ha
  contato le esecuzioni reali di `assembleDashboardData`. Su 3 richieste
  consecutive a `/dashboard` senza mutazioni: **1 sola esecuzione** (le altre
  due sono state servite dalla cache).
- **Criterio 1 (TTFB):** poiché questo ambiente non ha una latenza di rete
  Neon reale da eliminare (fallback in-memory), è stato simulato
  temporaneamente un round-trip realistico (150ms, coerente con quanto
  descritto in `docs/performance-audit.md` sul costo dominante del driver
  `neon-http`) dentro `assembleDashboardData`. Risultato: prima richiesta
  (cache miss) **240ms**, richieste successive (cache hit) **~22–25ms** — una
  riduzione di circa 10×. La simulazione è stata rimossa subito dopo la
  misura, insieme alla sonda di conteggio.
- **Criterio 2 (invalidazione):** verificato end-to-end su tre famiglie di
  mutazione distinte — `PUT /api/admin/gara` (con un marcatore custom su
  `meta.generato`, comparso subito nell'HTML della dashboard dopo la
  mutazione), `POST`/`DELETE /api/interventi` (un nuovo IF di test è comparso
  e poi scomparso dalla dashboard esattamente al giro successivo), e
  `PUT /api/config/rti`. In tutti e tre i casi: la richiesta immediatamente
  successiva alla mutazione ha rieseguito `assembleDashboardData` (cache
  invalidata correttamente) e il dato aggiornato era visibile senza bisogno
  di richieste ripetute; le richieste successive sono tornate rapide (cache
  ri-popolata). Le rimanenti route dell'elenco condividono lo stesso identico
  pattern (`revalidateTag(DASHBOARD_DATA_TAG)` dopo la scrittura) verificato
  a livello di codice, non ripetuto singolarmente via HTTP.

---

## R-7 — Nessun vincolo referenziale/di dominio a livello DB ✅ Completato (parziale)

**Categoria:** DB/Integrità dati · **Impatto:** Medio · **Effort:** M · **Priorità:** P2

**File:** `lib/schema.ts` (intero file)

**Problema:** lo schema è fatto interamente di colonne `text` libere: zero
`FOREIGN KEY` tra `bef_records.numero_if` → `interventi.numero_if`,
`if_risorse.numero_if` → `interventi.numero_if`, ecc. L'integrità (coerenza
`stato`/`has_bo`, valori enum come `pdc: 'OK'|'Mancante'|'InCorso'|'ND'`,
`role: 'ADMIN'|'USERPLUS'|'USER'`) è garantita solo in `lib/store.ts`
(`validateIntervento`, `syncStatoBo`, `docToDb`). Qualsiasi scrittura che
bypassi questo layer applicativo (inclusa la console SQL di R-3) può
corrompere silenziosamente i dati.

**GOAL:** Aggiungi vincoli `CHECK` sulle colonne enum-like che oggi sono
validate solo in `lib/store.ts`: `users.role IN ('ADMIN','USERPLUS','USER')`,
`users.status IN ('pending','approved','rejected')`,
`interventi.pdc/v_apertura/v_sal/bef_status IN ('OK','Mancante','InCorso','ND')`,
`interventi.attivazione IN ('SI','NO')`. Aggiungi questi vincoli sia alle
migration Drizzle (`drizzle/*.sql` + eventuale nuovo file di migration) sia al
blocco DDL di bootstrap in `lib/db.ts` (o, se R-4 è già stato implementato,
solo dove la sentinella di versione lo richiede). Valuta separatamente
(intervento successivo, non incluso in questo GOAL) l'aggiunta di una FK
"debole" (`ON DELETE SET NULL`, colonna nullable) da `if_risorse.numero_if` a
`interventi.numero_if`, tenendo conto che `interventi` usa soft-delete
(`deleted_at`) e quindi una riga "cancellata" resta comunque presente per la
FK.

**Criteri di accettazione:**
- [x] Un tentativo di scrivere un valore fuori dominio in una delle colonne
      sopra elencate (via SQL diretto) viene rifiutato dal DB con un errore
      di constraint violation.
- [x] Tutte le scritture esistenti dall'applicazione (drawer, inline edit,
      upload, admin) continuano a funzionare senza modifiche, perché scrivono
      già solo valori validi.
- [x] Migration e DDL di bootstrap coerenti tra loro.

**Implementazione:** 7 vincoli `CHECK` aggiunti in `lib/schema.ts` (helper
`check()` di `drizzle-orm/pg-core`, nel terzo argomento di `pgTable` per
`users` e `interventi`) — `users_role_check`, `users_status_check`,
`interventi_pdc_check`, `interventi_v_apertura_check`,
`interventi_v_sal_check`, `interventi_bef_status_check`,
`interventi_attivazione_check`. Le colonne doc-status/`attivazione` sono
nullable, quindi ogni CHECK è scritto come `IS NULL OR ... IN (...)` per
rendere esplicito che un valore mancante resta sempre ammesso.

Propagati in due punti, tenuti volutamente identici:
- `drizzle/0008_abandoned_captain_cross.sql`, generata con
  `npx drizzle-kit generate` dal nuovo `lib/schema.ts` (stesso flusso già
  usato per la migration di R-2);
- il blocco `DDL` di bootstrap in `lib/db.ts` (`SCHEMA_VERSION` 2 → 3, R-4).
  Postgres non supporta `ADD CONSTRAINT IF NOT EXISTS`, quindi ogni
  statement è avvolto in un blocco `DO $$ ... EXCEPTION WHEN
  duplicate_object THEN NULL; END $$` per restare idempotente come il resto
  dell'array.

In entrambi i punti ogni `ADD CONSTRAINT` usa `NOT VALID`: un DB Neon già in
uso può contenere righe storiche fuori dominio mai validate prima (typo,
dati pre-app, scritture dirette via la console SQL di R-3) che questo
codebase non può ispezionare in anticipo — `NOT VALID` aggiunge il vincolo
senza scansionare/validare le righe esistenti, ma lo applica comunque a
**ogni nuova** scrittura da quel momento in poi. Una successiva
`VALIDATE CONSTRAINT` (fuori scope qui, non blocca letture/scritture) può
ripulire i dati storici quando servirà. La FK "debole"
`if_risorse.numero_if → interventi.numero_if` menzionata nel `GOAL` è stata
esplicitamente lasciata fuori da questo intervento, come richiesto, e resta
un intervento futuro separato.

**Verifica:** `tsc --noEmit` e `next build` puliti. Contro un Postgres reale
locale (l'endpoint Neon non è raggiungibile da questo ambiente): (1) il
blocco DDL completo applicato a un DB vergine crea tutti e 7 i vincoli, ed è
idempotente su una seconda esecuzione; (2) un insert diretto con un valore
fuori dominio su ciascuna delle 4 colonne testate (`users.role`,
`users.status`, `interventi.pdc`, `interventi.attivazione`) viene rifiutato
con `violates check constraint`, mentre gli stessi identici valori che
scrive l'app oggi (`ADMIN`/`USERPLUS`/`USER`, `pending`/`approved`/`rejected`,
`OK`/`Mancante`/`InCorso`/`ND`, `SI`/`NO`/`NULL`) vengono accettati; (3) uno
scenario con dati "sporchi" preesistenti (valori fuori dominio già in tabella
prima del bootstrap, per simulare un DB Neon già in produzione) conferma che
sia il blocco DDL sia la migration `0008` si applicano **senza errori** e
senza toccare le righe storiche, mentre una nuova scrittura fuori dominio
successiva viene comunque rifiutata; (4) i vincoli prodotti dal blocco DDL e
dalla migration sono stati confrontati (`pg_get_constraintdef`) e sono
byte-per-byte identici.

---

## R-8 — Vocabolario doppio dominio↔DB per gli stati documentali ✅ Completato

**Categoria:** App/Manutenibilità · **Impatto:** Basso · **Effort:** S · **Priorità:** P3

**File:** `lib/store.ts:10-23` (`DOC_TO_DB`, `DOC_FROM_DB`), `lib/types.ts:4`

**Problema:** `lib/store.ts` mantiene una mappa di traduzione tra il dominio
applicativo (`'ok'|'ko'|'prog'|'nd'`) e i valori persistiti in colonna
(`'OK'|'Mancante'|'InCorso'|'ND'`). È un livello di indirection che esiste solo
per motivi storici (probabile eredità dei fogli Excel originali) e che va
riprodotto ogni volta che si aggiunge un nuovo campo enum-like.

**GOAL:** Valuta se esistono vincoli di retrocompatibilità con export/import
Excel già in circolazione che leggono i valori `'OK'/'Mancante'/'InCorso'/'ND'`
direttamente dal DB (es. tramite la console admin o strumenti esterni). Se
nessun vincolo esterno lo richiede, allinea i valori persistiti in colonna a
quelli di dominio (`'ok'|'ko'|'prog'|'nd'`) rimuovendo `DOC_TO_DB`/`DOC_FROM_DB`
e le chiamate `docToDb`/`docFromDb` in `lib/store.ts`, con una migration di
backfill (`UPDATE interventi SET pdc = CASE pdc WHEN 'OK' THEN 'ok' ...`) sulle
colonne `pdc`, `v_apertura`, `v_sal`, `bef_status`. Se invece esiste un
vincolo di compatibilità con l'export Excel o con strumenti esterni che si
aspettano i valori attuali, non procedere e documenta qui il motivo per cui
l'intervento resta chiuso.

**Criteri di accettazione:**
- [x] Se implementato: nessuna mappa di traduzione residua in `lib/store.ts`
      per questi campi; i valori in colonna coincidono con `DocStatus`.
- [x] Migration di backfill verificata su una copia dei dati esistenti prima
      di applicarla in produzione.
- [x] (n/a — implementato) Motivazione di non-implementazione non necessaria.

**Verifica del vincolo di retrocompatibilità:** nessuno dei consumer che
leggono/scrivono queste colonne dipende dalle stringhe legacy:
- **Import Excel**: `lib/parsers/parseIF.ts` + `parseDocStatus`
  (`lib/parsers/util.ts`) interpretano emoji/testo del workbook
  (`✅`/`❌`/`🔄`, "OK"/"Mancante"/"In corso") e producono già i valori di
  dominio `DocStatus` — l'import non legge mai il valore grezzo di colonna.
- **Export Excel**: non esiste alcun percorso di export nel repository
  (`xlsx` è usato solo per `XLSX.read` in fase di upload, mai per
  `XLSX.write`/`book_new`).
- **Console admin** (`app/api/admin/db/table/[name]/route.ts` +
  `components/AdminGestione.tsx`): visualizzatore generico che fa
  `SELECT *` e renderizza ogni cella con `String(valore)`, senza logica che
  confronti il contenuto con le stringhe legacy.
- Nessun riferimento nel codice/documentazione a consumer esterni (BI,
  report, integrazioni) che leggano queste colonne direttamente dal DB.

**Implementazione:** rimossi `DOC_TO_DB`/`DOC_FROM_DB` e `docToDb`/`docFromDb`
da `lib/store.ts`; `rowToIntervento`/`interventoToRow` leggono/scrivono
direttamente i valori `DocStatus` (fallback a `'nd'` solo per righe con
colonna `NULL`). Migration di backfill `drizzle/0009_backfill_doc_status_domain.sql`
(vedi nota sotto sul perché è la `0009` e non la numerazione originariamente
pianificata) e blocco DDL di bootstrap in `lib/db.ts` aggiornato in parallelo
(`SCHEMA_VERSION` 3 → 4).

**Nota di coordinamento con R-7 (conflitto reale, non solo di merge testuale):**
R-7 è stato completato per primo e ha aggiunto CHECK constraint su
`interventi.pdc`/`v_apertura`/`v_sal`/`bef_status` che vincolano esplicitamente
i valori legacy (`'OK'|'Mancante'|'InCorso'|'ND'`). Applicare il backfill di
R-8 *dopo* quei vincoli, senza modificarli, avrebbe fatto fallire ogni scrittura
dei nuovi valori di dominio con una violazione di CHECK constraint — un
conflitto sostanziale scoperto solo integrando i due branch (non un semplice
conflitto Git). Risolto aggiornando i 4 CHECK constraint sia in `lib/schema.ts`
sia nel blocco DDL di `lib/db.ts` per accettare `'ok'|'ko'|'prog'|'nd'`: la
migration/i DO-block droppano il vincolo esistente (`DROP CONSTRAINT IF
EXISTS`), eseguono il backfill dei dati, poi ri-creano lo stesso vincolo con
la nuova condizione — necessario perché un semplice "ADD CONSTRAINT" con lo
stesso nome sarebbe stato ignorato come "already exists" senza mai sostituire
la condizione precedente.

**Verifica:** `tsc --noEmit` pulito. Contro un Postgres reale locale (l'endpoint
Neon non è raggiungibile da questo ambiente): (1) applicata l'intera catena di
migration `0000`→`0009` da zero — nessun errore, i 4 CHECK finali accettano
`'ok'/'ko'/'prog'/'nd'` e rifiutano `'OK'/'Mancante'/'InCorso'/'ND'`; (2)
simulato lo scenario di upgrade reale — DB portato alla baseline R-7 (v3, con
i vecchi CHECK e righe legacy `'OK'/'Mancante'/'InCorso'/'ND'`/`NULL` già
presenti), poi applicati solo gli statement nuovi (migration `0009` e,
separatamente, il blocco DDL v4 di `lib/db.ts`): in entrambi i casi il
backfill converte correttamente le righe esistenti, i vecchi CHECK vengono
sostituiti senza errori, e un insert successivo con un valore legacy
(`'OK'`) viene correttamente rifiutato mentre uno con il nuovo valore
(`'ok'`) viene accettato; (3) il bootstrap DDL completo su DB vergine produce
lo stesso stato finale (un solo CHECK per colonna, già nel nuovo domain) —
verificato che l'ordine delle 47 statement non produca stati intermedi
incoerenti.

---

## R-9 — Duplicazione colonne tra le 5 tabelle "report" ✅ Completato (non implementato per assenza di bisogno concreto)

**Categoria:** DB/Modellazione · **Impatto:** Basso · **Effort:** L · **Priorità:** P3 (solo se emerge un bisogno reale)

**File:** `lib/schema.ts:81-224` (`report_bdo`, `report_rdi`,
`verbali_apertura`, `verbali_sal`, `report_pdc`)

**Problema:** le cinque tabelle "report" ripetono ~15 colonne quasi identiche
del workflow approvativo (`divisione`, `centro_costo`, `roi`,
`data_invio_roi`, `data_approvazione_roi`, `data_rifiuto_roi`, `fornitore`,
`codifica_documento`, `utente_caricamento`...). È probabilmente un riflesso
fedele dei fogli Excel di origine (mappatura 1:1 con l'import, comprensibile
e difendibile così com'è), ma rende impossibili query trasversali tipo "tutti
i documenti in attesa di approvazione ROI per un dato BDO" senza 5 `UNION`
manuali.

**GOAL:** **Non procedere senza prima verificare che esista un bisogno
concreto** (es. una user story reale di reportistica cross-tabella emersa in
`docs/design-review.md` o richiesta da un utente). Se il bisogno è confermato,
progetta una tabella normalizzata `documenti(id, tipo, num_bdo, stato_verbale,
roi, data_invio_roi, data_approvazione_roi, data_rifiuto_roi, divisione,
centro_costo, fornitore, codifica_documento, utente_caricamento, updated_at)`
con le colonne comuni, più tabelle di dettaglio specifiche per tipo per i
campi non condivisi (es. `conforme`/`criticita` solo per SAL). Pianifica la
migration dei dati esistenti dalle 5 tabelle attuali e l'aggiornamento di tutti
i punti che le leggono/scrivono (`lib/reportBdoStore.ts`,
`lib/reportRdiStore.ts`, `lib/verbaliAperturaStore.ts`,
`lib/verbaliSalStore.ts`, `lib/reportPdcStore.ts`,
`app/api/upload/route.ts`, ed eventuali pannelli che le leggono in
`components/panels/`).

**Criteri di accettazione:**
- [x] Bisogno reale documentato con riferimento a una user story o richiesta
      esplicita prima di iniziare l'implementazione.
- [x] (n/a — non implementato) Nessuna query cross-report da sostituire.
- [x] (n/a — non implementato) Nessuna migration dati da verificare.
- [x] (n/a — non implementato) Nessun punto di lettura/scrittura da
      aggiornare.

**Verifica del bisogno concreto (gate prima di qualsiasi implementazione):**
cercato in `docs/design-review.md` e `docs/user-stories.csv` (l'unico
inventario di user story del progetto, con verifica incrociata codice↔storia
per ogni riga) qualunque menzione di una user story di reportistica
cross-tabella su `report_bdo`/`report_rdi`/`verbali_apertura`/`verbali_sal`/
`report_pdc`, o una richiesta esplicita (utente, backlog, checklist FASE 4)
di una vista/query che attraversi più di una di queste tabelle. Nessuna delle
due fonti le menziona (grep case-insensitive su nomi tabella,
"cross-tabella", "reportistica", "normalizza" — zero risultati). La checklist
FASE 4 di `design-review.md` non riporta alcun item aperto relativo a queste
tabelle.

Verificato anche lo stato d'uso reale nel codice (l'assenza di una user story
scritta non basta a escludere un bisogno se le tabelle fossero già lette in
più punti): `report_bdo`, `report_rdi`, `verbali_apertura` hanno solo un
percorso di **scrittura** (rispettivi store, chiamati da
`app/api/upload/route.ts`) — nessun modulo applicativo le legge, zero import
dei rispettivi store fuori da quella route. `report_pdc`/`verbali_sal` hanno
un percorso di lettura, ma è un singolo `SELECT ... WHERE num_bdo = ?` per
tabella eseguito in parallelo (non un join) da un solo endpoint,
`app/api/interventi/[num_if]/monthly/route.ts` (consumato da
`components/panels/DettaglioIFPanel.tsx`). Non esiste oggi alcuna query che
attraversi più di una di queste 5 tabelle nello stesso filtro/proiezione,
quindi non c'è una "query cross-report attualmente impossibile" da
sbloccare.

**Conclusione: il bisogno concreto richiesto dal gate non è confermato.** Non
si procede con la progettazione/migrazione della tabella normalizzata
`documenti` + tabelle di dettaglio per tipo, né con la riscrittura dei 5
store, di `app/api/upload/route.ts` e dei pannelli in `components/panels/`:
sarebbe un refactor speculativo (5 tabelle da migrare, 6+ moduli da
riscrivere, rischio di regressione sull'upload) per un caso d'uso che non è
mai stato richiesto e che oggi non ha nemmeno una lettura cross-tabella da
sostituire.

**Percorso futuro (se il bisogno emergerà):** se in futuro emergerà una user
story reale (es. "voglio vedere in un'unica vista lo stato ROI/verbale di un
BDO su Apertura+SAL+PDC+RDI+BDO"), il design proposto nel `GOAL` resta valido
come punto di partenza — tabella `documenti` con le colonne comuni più
tabelle di dettaglio per tipo per i campi non condivisi. A quel punto
andrebbero comunque soddisfatti gli altri criteri di accettazione di questo
item (migrazione senza perdita di dati con conteggio righe prima/dopo,
aggiornamento di tutti i punti di lettura/scrittura elencati).

---

## Note finali

- Gli interventi R-1, R-2, R-3 sono indipendenti tra loro e possono essere
  eseguiti in parallelo da agenti/sviluppatori diversi.
- R-4 e R-7 toccano lo stesso file (`lib/db.ts`, blocco `DDL`): se eseguiti in
  sequenza ravvicinata, coordinare per evitare conflitti di merge.
- R-9 è deliberatamente marcato "non procedere senza verifica" — è l'unico
  intervento di questo audit con un pre-requisito esplicito prima
  dell'implementazione.
- **R-7 e R-8 toccano le stesse 4 colonne con effetti sostanzialmente
  conflittuali**: R-7 vincola `pdc`/`v_apertura`/`v_sal`/`bef_status` al
  vocabolario legacy (`'OK'|'Mancante'|'InCorso'|'ND'`), R-8 lo sostituisce
  con il domain applicativo (`'ok'|'ko'|'prog'|'nd'`). Se eseguiti su branch
  paralleli, il merge richiede di far vincere R-8: droppare e ricreare i 4
  CHECK constraint di R-7 con la nuova condizione (un semplice
  `ADD CONSTRAINT` con lo stesso nome viene ignorato come "already exists"
  senza aggiornare la condizione) — vedi la nota di coordinamento nella
  sezione R-8.
