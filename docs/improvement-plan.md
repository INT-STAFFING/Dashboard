# Piano di miglioramento — Dashboard ARIA SISS L2

Data: 2026-10-06 · Stack: Next.js 14 (App Router) · React 18 · TypeScript 5 · Drizzle + Neon (neon-http) · Vercel

Questo piano riguarda ciò che **manca** rispetto a `docs/performance-audit.md` e `docs/db-app-refactor-audit.md`. Gli interventi già completati in quei documenti (cache `unstable_cache` sul payload, `getSettingsBulk`, skeleton, memoizzazione dei pannelli, sentinella `schema_version`, upsert batchato dell'upload) sono dati per acquisiti. Ogni punto indica i file coinvolti, così da poter essere trasformato direttamente in una issue.

## Riepilogo

| # | Intervento | Area | Impatto | Sforzo | Fase |
|---|---|---|---|---|---|
| 1 | Funzioni Vercel nella stessa regione di Neon | Velocità | Molto alto | XS | 1 |
| 2 | Eliminare la query utente a ogni richiesta (cache per istanza, TTL 30 s) | Velocità / risorse | Alto | S | 1 |
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

Stato: **implementato.** Test: `tests/userCache.test.ts`, `tests/sessionUser.test.ts` (più due casi in `tests/adminAudit.test.ts`).

`getSessionUser()` (`lib/auth/index.ts`) eseguiva `getUserById` a ogni pagina e a ogni chiamata API: una richiesta HTTPS verso Neon ogni volta. Ora l'utente risolto dal cookie viene tenuto in una cache per istanza (`lib/auth/userCache.ts`), con TTL di 30 secondi (`SESSION_USER_CACHE_TTL_MS`, `0` la disattiva). Sul percorso caldo le richieste autenticate non toccano più il database (test: 10 richieste, 1 lettura).

**Scelta implementativa (diversa dalle due varianti elencate nella bozza).** Mettere ruolo e stato nel token richiederebbe un rinnovo periodico del cookie, che un server component non può impostare: gli utenti verrebbero disconnessi a ogni scadenza. `unstable_cache` con tag non è verificabile fuori da Next, e preferisco non consegnare codice di sicurezza che non posso collaudare. La cache di processo è semplice e interamente testata.

- **Invalidazione immediata** sull'istanza che serve la richiesta: approvazione, rifiuto, cambio ruolo, eliminazione (`lib/users.ts`) e qualsiasi istruzione riuscita della console SQL admin (che può modificare `users`).
- **Corse tra lettura e scrittura:** una lettura iniziata prima di un'invalidazione non ripopola la cache e le richieste successive non si agganciano a essa.
- Si memorizzano solo ricerche riuscite e solo `SafeUser` (mai l'hash della password); gli errori e gli utenti inesistenti non vengono memorizzati; i chiamanti ricevono copie; al massimo 500 voci.

**Compromesso da conoscere:** una modifica fatta da *un'altra* istanza serverless, o con SQL diretto sul database, arriva alle istanze già "calde" entro il TTL (30 s). Prima la revoca di un permesso era immediata ovunque. Per un tool interno è una latenza bassa, ma chi deve poter revocare un accesso in modo istantaneo può impostare `SESSION_USER_CACHE_TTL_MS=0` e tornare al comportamento precedente.

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

Stato: **implementato, tranne l'aggiornamento di `xlsx`** (bloccato nell'ambiente, vedi sotto). Test: `tests/securityConfig.test.ts`, `password.test.ts`, `loginThrottle.test.ts`, `loginRoute.test.ts`, `adminSeed.test.ts`, `adminAudit.test.ts`, `uploadSecret.test.ts`, `uploadRoute.test.ts`, `migrations.test.ts`.

- **Hash delle password asincrono.** `lib/auth/password.ts` usa `scrypt` asincrono (thread pool di libuv) invece di `scryptSync`: lo stesso formato `s1$salt$hash` e gli stessi parametri, quindi gli hash esistenti continuano a funzionare. Un'email inesistente costa lo stesso lavoro di una password sbagliata (hash fittizio), così i tempi di risposta non rivelano quali email sono registrate.
- **Rate limit del login** (`lib/auth/loginThrottle.ts`): 10 tentativi falliti per email e 30 per IP ogni 15 minuti, `429` con `Retry-After`. I contatori stanno nella tabella `login_attempts` (valgono tra istanze serverless; senza database, in memoria), le righe fuori finestra vengono potate a ogni nuovo fallimento, un login riuscito azzera il contatore dell'email. Compromesso noto: chi conosce un'email può bloccarne il form di login per 15 minuti sbagliando di proposito; le sessioni già aperte non sono toccate. Se il contatore non è leggibile il login prosegue (fail-open, errore a log), per non bloccare tutti gli utenti per un guasto del limitatore.
- **Configurazione non sicura in produzione** (`lib/security/config.ts`, `instrumentation.ts`): in un runtime di produzione l'avvio fallisce se `AUTH_SECRET` manca, è un valore di default o coincide con `UPLOAD_SECRET`, o se non c'è nessun database. `getAuthSecret()` non ricade più su `UPLOAD_SECRET` in produzione (chi carica file potrebbe altrimenti falsificare sessioni ADMIN). `ADMIN_PASSWORD` non può essere vuota o `admin` quando l'account amministratore viene creato. Preview e sviluppo stampano solo un avviso; `ALLOW_INSECURE_CONFIG=true` è l'uscita di sicurezza esplicita per provare una build di produzione in locale. Verificato con un `next start` reale: senza variabili risponde 500 con l'elenco dei problemi, con variabili corrette risponde 200.
- **`UPLOAD_SECRET` solo nell'header** `x-upload-secret` (`lib/auth/uploadSecret.ts`, confronto a tempo costante); la pagina `/upload` lo invia come header. Il parametro `?token=` non è più accettato.
- **Audit della console SQL admin** (`lib/adminAudit.ts`): ogni istruzione viene scritta in `admin_audit_log` (utente, istruzione, esito, righe, durata) *prima* dell'esecuzione; se la scrittura fallisce l'istruzione non viene eseguita. Limite: il log sta nello stesso database, quindi un admin può ancora modificarlo dalla stessa console; registra ciò che è stato fatto, non è a prova di manomissione.
- **Schema:** nuove tabelle `login_attempts` e `admin_audit_log` (`SCHEMA_VERSION` 8, DDL in `lib/db.ts` e migrazione `drizzle/0012_login_attempts_admin_audit.sql`).
- **Non completato — `xlsx@0.18.5`.** Su npm esiste solo la 0.18.5; le versioni corrette (0.20.x) sono distribuite dal CDN di SheetJS (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), che la policy di rete di questo ambiente blocca (403). Va installato da un ambiente che raggiunga quell'host: `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, poi ripetere test e build. L'alternativa `exceljs` richiederebbe di riscrivere i parser.

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
