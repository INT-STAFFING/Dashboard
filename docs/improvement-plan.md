# Piano di miglioramento — Dashboard ARIA SISS L2

Data: 2026-10-06 · Stack: Next.js 14 (App Router) · React 18 · TypeScript 5 · Drizzle + Neon (neon-http) · Vercel

Questo piano riguarda ciò che **manca** rispetto a `docs/performance-audit.md` e `docs/db-app-refactor-audit.md`. Gli interventi già completati in quei documenti (cache `unstable_cache` sul payload, `getSettingsBulk`, skeleton, memoizzazione dei pannelli, sentinella `schema_version`, upsert batchato dell'upload) sono dati per acquisiti. Ogni punto indica i file coinvolti, così da poter essere trasformato direttamente in una issue.

## Riepilogo

| # | Intervento | Area | Impatto | Sforzo | Fase |
|---|---|---|---|---|---|
| 1 | Funzioni Vercel nella stessa regione di Neon | Velocità | Molto alto | XS | 1 |
| 2 | Eliminare la query utente a ogni richiesta | Velocità / risorse | Alto | S | 1 |
| 3 | Idempotenza dell'import `verbali_sal` (duplicava le righe) | Scalabilità / dati | Alto | S | 1 |
| 4 | Upsert, DDL e seed in un'unica richiesta HTTP | Risorse | Medio | S | 1 |
| 5 | Blocchi di sicurezza che sono anche spreco di risorse | Sicurezza | Alto | S | 1 |
| 6 | Test, CI e misurazioni | Fondamenta | Alto | M | 2 |
| 7 | Caricamento progressivo di pannelli, drawer ed export | Bundle | Medio | S | 2 |
| 8 | Parsing Excel in un Web Worker | Reattività | Medio | S | 2 |
| 9 | Rimuovere l'anno 2026 dal modello dati | Scalabilità | Molto alto | L | 3 |
| 10 | Nuove funzionalità: anteprima upload, storico, filtri nell'URL, alert | Funzionalità | Alto | M–L | 4 |

Ordine consigliato per la prima iterazione: 1 → 3 → 5 → 2 → 4 → 6. Sono interventi piccoli, indipendenti e misurabili. Il punto 9 è la decisione architetturale da prendere prima della chiusura dell'esercizio 2026.

## Fase 1 — Risultati rapidi (circa 1 settimana)

### 1. Regione delle funzioni

`vercel.json` contiene solo `{"framework":"nextjs"}`, quindi le funzioni girano nella regione di default di Vercel (`iad1`, Washington), mentre la connection string d'esempio in `.env.example` punta a Neon `eu-central-1`. Con il driver neon-http ogni query è una richiesta HTTPS, quindi ogni round-trip attraversa l'Atlantico (circa 80–100 ms). Aggiungere `"regions": ["fra1"]` a `vercel.json` riduce di un ordine di grandezza la latenza di tutto ciò che non passa dalla cache: login, mutazioni, drill-down, area admin e la ricostruzione del payload. Prima di applicarlo va verificata la regione dell'endpoint Neon reale.

### 2. Sessione senza accesso al database

`getSessionUser()` (`lib/auth/index.ts:9`) esegue `getUserById` a ogni pagina e a ogni chiamata API, e ogni volta passa anche da `ensureSeed`. Il middleware verifica già la firma del token. Due strade equivalenti:

- inserire `role`, `status` e un campo `session_version` (nuova colonna su `users`) nel payload firmato, con una scadenza breve (ad esempio 15 minuti) e rinnovo trasparente;
- oppure tenere in cache la lettura dell'utente con `unstable_cache` e il tag `user:{id}`, invalidandola in `approveUser`, `rejectUser`, `setUserRole` e `deleteUser` (`lib/users.ts`).

In entrambi i casi si risparmia un round-trip per richiesta e la revoca dei permessi resta rapida.

### 3. Duplicazione di `verbali_sal`

`lib/verbaliSalStore.ts` configura lo store in sola aggiunta: `lib/dualModeStore.ts` eseguiva un semplice `insert` a ogni caricamento. Ricaricare lo stesso REPORT Sal raddoppiava quindi le righe: la tabella cresceva senza limite e il drill-down Dettaglio IF mostrava mesi duplicati. Lo store in memoria, invece, sostituiva già le righe per BDO: le due modalità erano incoerenti.

**Scelta implementativa (diversa dalla bozza iniziale del piano).** La bozza proponeva una chiave naturale con indice unique. È stata scartata: l'audit R-2 aveva già escluso questa tabella proprio perché una chiave collasserebbe righe che devono poter coesistere, e non c'è modo di verificare dai dati del repository che `codifica_documento` sia unica per riga. È stato invece reso idempotente l'append (`insertMissing` in `lib/dualModeStore.ts`):

- una riga identica in tutte le colonne a una già salvata per lo stesso BDO non viene inserita di nuovo; il confronto è per molteplicità, quindi righe identiche ripetute nello stesso file restano distinte;
- le righe dei caricamenti precedenti non vengono mai modificate né cancellate: un file con nuovi periodi aggiunge righe, come prima;
- una riga con contenuto diverso (ad esempio uno stato aggiornato) viene aggiunta accanto alla precedente: la versione vecchia non viene sovrascritta;
- gli INSERT sono divisi in blocchi da 500 righe dentro un unico `db.batch` (una transazione), per non superare il limite di 65.535 parametri di Postgres;
- nessuna migrazione e nessun bump di `SCHEMA_VERSION`: lo schema non cambia.

**Duplicati già presenti.** Le righe duplicate create dai caricamenti precedenti non vengono rimosse in automatico, perché non si può distinguere con certezza un duplicato da due righe legittime identiche. Se serve ripulirle, questa query (da eseguire dalla console SQL admin dopo un backup) tiene la riga con `id` più basso per ogni gruppo di righe identiche in tutte le colonne:

<!-- sal-dedup-sql -->
```sql
DELETE FROM verbali_sal WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY num_bdo, descrizione, nome_file, codifica_documento, stato_verbale,
        periodo_competenza, conforme, motivo_conformita, criticita, motivazione_criticita,
        livelli_servizio_rispettati, divisione, centro_costo, fornitore,
        utente_caricamento_fornitore, data_firma_fornitore, roi,
        data_inserimento_verbale_non_sottomesso, data_sottomissione_verbale_fornitore,
        data_firma_roi, data_rifiuto_roi, data_invio_roi
      ORDER BY id
    ) AS rn
    FROM verbali_sal
  ) t WHERE rn > 1
)
```

**Limite noto.** Se il REPORT Sal è uno snapshot completo e uno stato cambia tra due esportazioni, la versione vecchia della riga resta accanto alla nuova. È il comportamento che l'applicazione aveva già; sostituire le righe per BDO sarebbe corretto solo se ogni esportazione contenesse l'intera storia di quel BDO, cosa non verificabile dal codice. Test: `tests/verbaliSalStore.test.ts`.

### 4. Un solo round-trip per scrittura

- `lib/store.ts:1084-1095`: gli aggiornamenti dell'upload partono a gruppi di 8 `UPDATE`. Sostituirli con un'unica `INSERT … ON CONFLICT (numero_if) DO UPDATE SET …` multi-riga, usando l'helper `excludedSet` già presente in `lib/db.ts:580`.
- `lib/db.ts:557`: il bootstrap DDL esegue oltre 50 statement in sequenza quando la versione dello schema cambia. Con `db.batch([...])`, già usato in `dualModeStore`, diventa una sola richiesta transazionale.
- `lib/store.ts:852`: il seed iniziale degli interventi inserisce una riga alla volta; va trasformato in un insert unico.
- `app/api/interventi/[num_if]/monthly/route.ts`: esegue prima `getIntervento` e poi tre query in parallelo. Il client conosce già il `bdo`, quindi può passarlo come parametro e ridurre il tutto a un solo passaggio.
- `app/api/data/route.ts`: non è usata da nessun componente, esegue 7 query senza batch e salta la cache. Va rimossa, oppure deve limitarsi a chiamare `getDashboardData()`.

### 5. Sicurezza che pesa anche sulle risorse

- **Hash delle password sincrono.** `verifyPassword` usa `scryptSync` (`lib/auth/password.ts:17`): blocca l'event loop per circa 50–100 ms a ogni tentativo, e il login non ha limiti di frequenza, quindi un attacco di forza bruta satura la funzione. Servono `scrypt` asincrono e un rate limit per IP ed email (tabella `login_attempts` oppure Upstash).
- **Segreti di default.** `getAuthSecret()` ricade su un segreto pubblico scritto nel codice (`lib/auth/session.ts:18-24`) e l'admin ha `admin` come password di default. In produzione l'avvio deve fallire se `AUTH_SECRET` o `ADMIN_PASSWORD` mancano o hanno i valori di default (punto R-1 ancora aperto nell'audit).
- **Database obbligatorio in produzione.** Oggi, senza `DATABASE_URL`, l'app passa senza avvisi allo store in memoria: ogni istanza vede dati diversi e le modifiche si perdono. In produzione l'avvio deve fallire.
- **Token nella query string.** `UPLOAD_SECRET` è accettato anche come `?token=` (`app/api/upload/route.ts:30-37`) e finisce nei log di accesso. Va accettato solo nell'header `x-upload-secret`.
- **`xlsx@0.18.5` da npm** non è più mantenuto e ha CVE note (prototype pollution, ReDoS) proprio sul parsing di file caricati dagli utenti. Va sostituito con la build 0.20.x distribuita dal CDN ufficiale di SheetJS oppure con `exceljs`.
- **Console SQL admin senza audit trail** (punto R-3 ancora aperto): aggiungere una tabella `admin_audit_log` con utente, istruzione, esito e durata.

## Fase 2 — Fondamenta e frontend (2–3 settimane)

### 6. Test, CI e misurazioni

Il repository non ha test, workflow CI né metriche, quindi oggi nessuna ottimizzazione è verificabile.

- Aggiungere Vitest sulle funzioni pure: `lib/queries.ts`, `lib/fiscal.ts`, gli aggregati in `lib/befStore.ts`, `mergeUpload` in `lib/store.ts` e i parser in `lib/parsers/`, con fixture anonimizzate dei file Excel reali.
- Aggiungere un workflow GitHub Actions che esegua typecheck, lint, test e `next build`.
- Per le misure in produzione: `@vercel/speed-insights` e un log dei tempi di `assembleDashboardData` e dei tempi dell'upload.

Ogni punto di questo piano dovrebbe chiudersi con un numero prima e uno dopo.

### 7. Bundle a caricamento progressivo

`components/Dashboard.tsx:9-17` importa staticamente tutti e 8 i pannelli e `EditDrawer`.

- Caricare con `next/dynamic` tutti i pannelli tranne quello della tab predefinita, con un `loading` che riusa gli skeleton esistenti.
- `components/export/ExportControls.tsx` importa `lib/exportImage.ts` (410 righe) in ogni grafico: basta un `await import()` al clic.
- `components/AdminGestione.tsx` (1.446 righe, un unico modulo client) va diviso in sotto-route (`/admin/gestione/gara`, `/risorse`, `/bef`, `/db`), così ogni sezione scarica solo il proprio codice.

### 8. Upload senza blocchi

`app/upload/page.tsx:88-92` esegue `parseFile` nel thread principale: con file grandi la pagina si blocca e la barra di avanzamento resta ferma. Spostare il parser in un Web Worker. Per crescere oltre il limite di 4,5 MB anche sul JSON già estratto, dividere l'invio in blocchi per tipo di record, oppure usare Vercel Blob con parsing lato server.

## Fase 3 — Scalabilità del modello dati (circa 1 mese)

### 9. Dimensione temporale

Lo schema contiene `revenue_2026`, `rev_mesi` e `cons_mesi` come array fissi di 12 elementi, e `lib/queries.ts:111` ha l'anno `2026-` scritto a mano. Al cambio di esercizio il modello non regge: lo storico verrebbe sovrascritto oppure servirebbe una nuova colonna per anno.

Il modello corretto è una tabella `intervento_mesi(numero_if, anno, mese, revenue, consuntivo)` con chiave composta e indice su `(anno, numero_if)`. La migrazione deve copiare i dati esistenti; il payload va filtrato per anno con un selettore nell'interfaccia; la cache va divisa per anno con chiavi come `dashboard-data:{anno}`.

Insieme a questo conviene spostare filtri e aggregazioni dal client al server. Oggi ogni filtro scorre l'intero portafoglio nel browser; diventa un problema oltre qualche migliaio di righe, ed è il momento in cui aggiungere anche la virtualizzazione del registro Operativo.

## Fase 4 — Funzionalità (in parallelo alla Fase 3)

Le nuove funzionalità più utili partono da dati che l'applicazione calcola già. Storico e alert diventano più semplici dopo il punto 9.

- **Anteprima dell'upload.** `upsertInterventiFromUpload` produce già `insertedIfs`, `updatedIfs` e `skippedIfs`. Un parametro `?dryRun=true` permette di mostrare le differenze campo per campo prima di confermare, riducendo gli errori di caricamento senza costi infrastrutturali.
- **Storico delle modifiche.** Una tabella `interventi_history`, alimentata nello stesso batch di ogni `updateIntervento` e di ogni upload, permette di vedere chi ha cambiato cosa e quando e di annullare una modifica. Oggi esistono solo `last_edited_by` e `last_edited_at`.
- **Registro degli upload.** Una tabella `upload_log` con file, utente, conteggi e durata, consultabile dall'area admin.
- **Filtri nell'URL.** I filtri vivono in `useState` e si perdono al ricaricamento. Sincronizzandoli con `searchParams` le viste diventano condivisibili e il tasto "indietro" funziona.
- **Alert proattivi.** Un job Vercel Cron settimanale può segnalare via email gli IF in scadenza (`data_fine`), il BEF fatturabile non ancora emesso e i verbali mancanti. I dati necessari sono già nel payload.
- **Credenziali self-service.** Non esistono né il cambio password né il reset della password.

## Criteri di verifica

Per evitare ottimizzazioni non dimostrate, ogni intervento si considera chiuso solo con una misura associata:

- punto 1: TTFB di `/dashboard` con cache fredda e latenza di `POST /api/auth/login`, prima e dopo, dalla stessa rete;
- punto 2: numero di query per richiesta autenticata (da 1 a 0 sul percorso caldo);
- punto 3: numero di righe di `verbali_sal` dopo due caricamenti consecutivi dello stesso file (deve restare invariato; coperto da `tests/verbaliSalStore.test.ts`);
- punto 4: numero di richieste HTTP verso Neon durante un upload da 200 righe e durante un bootstrap DDL;
- punti 7 e 8: JS di primo caricamento di `/dashboard` (riferimento attuale in `docs/performance-audit.md`: circa 118 kB) e durata del blocco del thread principale durante il parsing di un file di prova;
- punto 9: test di migrazione che confrontano i totali di revenue e consuntivo prima e dopo, per ogni intervento.
