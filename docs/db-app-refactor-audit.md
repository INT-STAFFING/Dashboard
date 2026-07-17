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

| ID | Titolo | Categoria | Impatto | Effort | Priorità |
|----|--------|-----------|---------|--------|----------|
| R-1 | Fallback insicuro per `AUTH_SECRET` in produzione | Security | Alto | S | P1 |
| R-2 | Scritture non atomiche (delete+insert) nelle store di snapshot | DB/Integrità | Alto | M | P1 |
| R-3 | Console SQL admin senza audit trail | Security | Alto | S | P1 |
| R-4 | Doppia fonte di verità per lo schema DB (DDL bootstrap vs migration) | DB/Manutenibilità | Medio | M | P2 |
| R-5 | Duplicazione strutturale negli store di upload | App/Manutenibilità | Medio | M | P2 |
| R-6 | Cache assente sul payload SSR della dashboard | Rete/Performance | Medio | L | P2 |
| R-7 | Nessun vincolo referenziale/di dominio a livello DB | DB/Integrità | Medio | M | P2 |
| R-8 | Vocabolario doppio dominio↔DB per gli stati documentali | App/Manutenibilità | Basso | S | P3 |
| R-9 | Duplicazione colonne tra le 5 tabelle "report" | DB/Modellazione | Basso | L | P3 |

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

## R-2 — Scritture non atomiche (delete+insert) nelle store di snapshot

**Categoria:** DB/Integrità dati · **Impatto:** Alto · **Effort:** M · **Priorità:** P1

**File:** `lib/verbaliAperturaStore.ts:29-32`, `lib/verbaliSalStore.ts`,
`lib/reportPdcStore.ts:42-43`, `lib/befStore.ts:114-129` (`replaceBef`)

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
- [ ] Un fallimento simulato a metà della fase "insert" lascia la tabella nello
      stato precedente (nessuna riga persa), verificato con un test manuale o
      automatico che inietta un errore.
- [ ] Il comportamento funzionale dell'upload (stesso file ricaricato più
      volte → stesso risultato finale) resta invariato.
- [ ] Schema e migration aggiornati e coerenti tra `lib/schema.ts`,
      `lib/db.ts` e `drizzle/*.sql`.

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

## R-4 — Doppia fonte di verità per lo schema DB

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
- [ ] Su un DB già provisionato alla versione corrente, `ensureSchema()` fa un
      solo round-trip invece di eseguire tutti gli statement DDL.
- [ ] Su un DB vergine, il bootstrap crea correttamente tutte le tabelle e
      imposta la sentinella alla versione corrente.
- [ ] Nessuna regressione sull'auto-provisioning che oggi garantisce il
      funzionamento su DB vuoto.

---

## R-5 — Duplicazione strutturale negli store di upload

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
- [ ] Comportamento di upload/lettura identico prima e dopo per tutte le
      tabelle migrate (stesso file caricato due volte produce lo stesso
      risultato di `saved`/`ignored`).
- [ ] Riduzione misurabile delle righe duplicate (obiettivo indicativo:
      -250/-350 righe nette tra store e normalizzatori).
- [ ] Nessuna modifica alla firma pubblica delle funzioni consumate da
      `app/api/upload/route.ts` e dagli altri chiamanti.

---

## R-6 — Cache assente sul payload SSR della dashboard

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
- [ ] Il TTFB di `/dashboard` in lettura ripetuta (nessuna mutazione nel
      mezzo) è misurabilmente più basso.
- [ ] Ogni mutazione (creazione/modifica/cancellazione intervento, upload,
      modifica admin, modifica config RTI) invalida correttamente la cache:
      il dato aggiornato è visibile all'utente entro la richiesta successiva.
- [ ] Nessuna route di mutazione dimenticata (verifica incrociata con
      l'elenco in `app/api/**`).

---

## R-7 — Nessun vincolo referenziale/di dominio a livello DB

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
- [ ] Un tentativo di scrivere un valore fuori dominio in una delle colonne
      sopra elencate (via SQL diretto) viene rifiutato dal DB con un errore
      di constraint violation.
- [ ] Tutte le scritture esistenti dall'applicazione (drawer, inline edit,
      upload, admin) continuano a funzionare senza modifiche, perché scrivono
      già solo valori validi.
- [ ] Migration e DDL di bootstrap coerenti tra loro.

---

## R-8 — Vocabolario doppio dominio↔DB per gli stati documentali

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
- [ ] Se implementato: nessuna mappa di traduzione residua in `lib/store.ts`
      per questi campi; i valori in colonna coincidono con `DocStatus`.
- [ ] Migration di backfill verificata su una copia dei dati esistenti prima
      di applicarla in produzione.
- [ ] Se non implementato per vincolo di compatibilità: motivazione
      documentata in questo file.

---

## R-9 — Duplicazione colonne tra le 5 tabelle "report"

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
- [ ] Bisogno reale documentato con riferimento a una user story o richiesta
      esplicita prima di iniziare l'implementazione.
- [ ] Se implementato: tutte le query cross-report attualmente impossibili
      diventano una singola query sulla tabella normalizzata.
- [ ] Nessuna perdita di dati nella migration (conteggio righe prima/dopo
      per ciascuna tabella sorgente).
- [ ] Tutti i punti di lettura/scrittura elencati sopra aggiornati e
      funzionanti.

---

## Note finali

- Gli interventi R-1, R-2, R-3 sono indipendenti tra loro e possono essere
  eseguiti in parallelo da agenti/sviluppatori diversi.
- R-4 e R-7 toccano lo stesso file (`lib/db.ts`, blocco `DDL`): se eseguiti in
  sequenza ravvicinata, coordinare per evitare conflitti di merge.
- R-9 è deliberatamente marcato "non procedere senza verifica" — è l'unico
  intervento di questo audit con un pre-requisito esplicito prima
  dell'implementazione.
