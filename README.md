# Dashboard ARIA SISS L2 — Web App

Full-stack **Next.js 14** (App Router, TypeScript) port of the static
`Dashboard_IF_ARIA_SISS` HTML. Carica i dati da file Excel, li renderizza con
la stessa logica della dashboard originale e aggiorna il proprio database quando
vengono caricati nuovi file. Deployabile su **Vercel** senza configurazioni
manuali.

## Stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** + variabili CSS della palette originale (`--petrol`, `--gold`, …)
- **xlsx** (SheetJS) per la lettura Excel lato server
- **Drizzle ORM** + **Neon** (serverless Postgres, driver `@neondatabase/serverless`), con fallback in-memory a zero config

## Avvio locale

```bash
npm install
npm run dev          # http://localhost:3000 → /dashboard
```

Senza `DATABASE_URL` l'app usa automaticamente un **seed in memoria** (24
interventi, estratti dalla dashboard originale): build e demo funzionano subito.
Con un connection string **Neon** in `DATABASE_URL` usa Postgres in modo persistente.

```bash
cp .env.example .env.local        # imposta DATABASE_URL (Neon) e UPLOAD_SECRET
npm run db:push                   # crea le tabelle (Drizzle)
npm run db:seed                   # popola con il portafoglio baseline
```

### Neon su Vercel

Aggiungi un database **Neon** dal Vercel Marketplace (Storage → Neon): l'integrazione
imposta automaticamente `DATABASE_URL` (e `POSTGRES_URL`) negli env del progetto.
In locale copia la connection string dalla dashboard Neon.

## Struttura

```
app/
  dashboard/page.tsx     SSR + dashboard client interattiva
  upload/page.tsx        Upload drag-and-drop (protetto da UPLOAD_SECRET)
  api/
    data/route.ts        GET  dati aggregati + KPI
    upload/route.ts      POST upload Excel → upsert DB (merge-aware)
    interventi/route.ts  POST nuovo intervento
    interventi/[num_if]/ PUT (modifica) · DELETE (soft-delete) · GET
    config/rti/route.ts  PUT parametri RTI
lib/
  schema.ts  db.ts  store.ts   Drizzle + store (DB o in-memory)
  parsers/                      parseIF · parseBEF · parseChiusura · parseAggregatore · parseDashboard
  queries.ts  charts.ts  format.ts
  exportImage.ts  exportTable.ts  grafici → JPG/PNG · tabelle → testo per Excel
components/
  Dashboard.tsx  FilterBar.tsx
  panels/        Overview · RTI · Timeline · Distribuzione · Modalità · Stato · Operativo
  editing/       EditDrawer · InlineField · StatusSelect · NotePreview
  export/        ChartCard · ChartExportButtons · CopyTableButton
```

## Autenticazione & ruoli

L'app è protetta da login. Le pagine e le API richiedono una sessione valida
(cookie firmato HMAC, verificato anche dal middleware Edge).

| Ruolo      | Registrazione | Accesso                | Permessi                          |
| ---------- | ------------- | ---------------------- | --------------------------------- |
| `ADMIN`    | — (seed)      | sempre attivo          | tutto + gestione utenti           |
| `USERPLUS` | sì            | dopo approvazione ADMIN| visualizzazione **e modifica**    |
| `USER`     | sì            | dopo approvazione ADMIN| **sola visualizzazione**          |

- **ADMIN**: account iniziale creato in automatico al primo avvio da
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` (default `admin@dashboard.local` / `admin`).
  Non è eliminabile e ha sempre accesso a tutto, inclusa la pagina
  **Gestione utenti** (`/admin/users`) per approvare/rifiutare le registrazioni,
  cambiare ruolo ed eliminare account.
- **USER / USERPLUS**: si registrano da `/register` e restano in stato
  `pending` finché un ADMIN non li approva. USER vede i dati in sola lettura;
  USERPLUS può anche modificare/creare/eliminare e caricare Excel.

Pagine: `/login` · `/register` · `/admin/users` (solo ADMIN).
API: `POST /api/auth/{register,login,logout}` · `GET /api/me` ·
`GET/PATCH/DELETE /api/admin/users[/:id]`.

> Con `DATABASE_URL` configurato esegui `npm run db:push` per creare anche la
> tabella `users`. Senza DB gli utenti vivono nello store in-memory (solo demo).

## Pannelli

1. **Overview & KPI** — KPI card, revenue mensile (barre + cumulato), indicatori
2. **Quote RTI ed erosione** — donut composizione RTI, erosione massimale/quote, config editabile
3. **Timeline finanziaria** — Revenue vs Fatturazione, toggle mensile/trimestrale
4. **Distribuzione IF** — per Ambito · per Referente ARIA · per Seniority (GdL)
5. **Modalità fornitura** — donut/barre per tipologia contrattuale (con drill-down)
6. **Stato IF / BO** — stato BO, IF da presidiare, subappalti (con drill-down)
7. **Operativo (Registro IF)** — tabella completa con **editing inline**, drawer di
   modifica, creazione, soft-delete, ricerca, ordinamento ed **export CSV**

## Export di grafici e tabelle

Ogni grafico e ogni tabella dell'applicazione (dashboard, Gestione dati,
Gestione utenti) espone i propri comandi di export, senza dipendenze esterne:
la rasterizzazione passa da un clone del nodo con gli stili calcolati
inlinizzati dentro un `<foreignObject>` SVG, poi su `<canvas>`.

- **🖼️ Copia grafico** — mette il grafico negli appunti come immagine, pronta da
  incollare in Word, Excel, PowerPoint o in una mail. L'immagine include titolo,
  didascalia, legenda e la data di estrazione, a risoluzione doppia.
- **⤓ JPG** — scarica lo stesso grafico come file `.jpg`
  (`<Nome_grafico>_AAAA-MM-GG.jpg`).
- **📋 Copia per Excel** — copia **tutti** i dati della tabella (non solo le
  righe visibili a schermo) come testo tabulato + tabella HTML: incollando in un
  foglio Excel i valori finiscono già separati in celle. Le colonne di soli
  pulsanti vengono escluse; sulle tabelle editabili i valori copiati sono quelli
  correnti dei campi.

Gli appunti di sistema accettano solo `image/png` per le immagini, quindi
"Copia grafico" incolla un PNG mentre il file scaricato è un JPG; dove l'API
appunti non è disponibile (contesto non sicuro, browser datati) il pulsante
ripiega automaticamente sul download.

Le tabelle Registro IF e Dettaglio IF mantengono anche l'**export CSV**
dedicato, con le stesse colonne della copia per Excel.

Codice: `lib/exportImage.ts` (grafici), `lib/exportTable.ts` (tabelle),
`components/export/ExportControls.tsx` (`ChartCard`, `ChartExportButtons`,
`CopyTableButton`). Un elemento marcato `data-export-ignore` viene escluso sia
dall'immagine sia dalla copia testuale (es. i suggerimenti "clic per…").

## Anno di riferimento

I valori mensili di revenue e consuntivo sono salvati per anno nella tabella
`intervento_mesi`. Il selettore **Anno** in intestazione (`/dashboard?anno=AAAA`)
cambia KPI, grafici ed export; senza parametro vale l'anno corrente se ha dati,
altrimenti il più vicino con dati. Un nuovo anno si aggiunge dal selettore in
Gestione › IF/BO; l'upload del workbook Dashboard carica tutti gli anni presenti
in `TIMELINE_REVENUE` senza toccare quelli assenti dal file.

## Editing & merge

- Modifica inline (click-to-edit) e drawer completo → `PUT /api/interventi/[num_if]`
- Creazione → `POST /api/interventi` · Eliminazione soft → `DELETE` (`deleted_at`)
- Ogni modifica da UI imposta `edited_manually = true`: il successivo upload Excel
  **non sovrascrive** i record modificati a mano, salvo `?force=true`.

## Upload

`POST /api/upload` (multipart, campo `file`). Il tipo è riconosciuto dal nome
(o dal contenuto come fallback): `Dashboard` · `IF_ARIA` · `BEF` · `Chiusura` ·
`Aggregatore`. Il workbook **Dashboard ARIA SISS** è la fonte della revenue
mensile (fogli `DATI` + `TIMELINE_REVENUE`); l'upsert è *merge-aware*, quindi un
file aggiorna solo i campi che effettivamente contiene senza azzerare gli altri
(es. la revenue non viene persa caricando un IF_ARIA). Protetto da
`UPLOAD_SECRET`, da inviare **solo** nell'header `x-upload-secret` (il parametro `?token=` non è più accettato: le query string finiscono nei log di accesso). Pagina UI: `/upload`.

## Sviluppo e verifica

```bash
npm test               # Vitest; usa un Postgres in-process (PGlite), nessun DB esterno
npm run test:coverage  # copertura di lib/
npm run typecheck      # tsc --noEmit
npm run lint           # next lint (next/core-web-vitals)
npm run build
```

La CI (`.github/workflows/ci.yml`) esegue typecheck, lint, test e build su ogni pull
request e su `main`. In produzione il server scrive nei log una riga `[perf] {...}` per
la ricostruzione del payload della dashboard e per ogni upload (`PERF_LOG=off` per
silenziarle); Vercel Speed Insights va abilitato dalle impostazioni del progetto.

## Sicurezza e configurazione di produzione

In un runtime di **produzione** (Vercel `production`, oppure `next start` fuori da Vercel)
l'app rifiuta di avviarsi con una configurazione non sicura: `instrumentation.ts`
controlla le variabili all'avvio e risponde 500 con l'elenco di ciò che manca.

- `AUTH_SECRET` obbligatorio, casuale e diverso da `UPLOAD_SECRET` e dai valori di
  default del repository. In produzione **non** ricade più su `UPLOAD_SECRET`: chi
  carica file conosce quel segreto e potrebbe altrimenti falsificare sessioni ADMIN.
- Un database (`DATABASE_URL` o uno degli alias supportati) è obbligatorio: senza,
  i dati finirebbero in memoria, separati per istanza e persi a ogni riavvio.
- `ADMIN_PASSWORD` non può essere vuota né `admin` nel momento in cui l'account
  amministratore viene **creato** (primo avvio su database vuoto). Un amministratore
  già presente non viene toccato: per cambiargli la password, dopo un backup,
  eliminare la sua riga da `users` e rideployare con una nuova `ADMIN_PASSWORD`
  (viene ricreato con quella).
- Preview di Vercel e `next dev` non sono produzione: stampano solo un avviso.
- Per provare in locale una build di produzione senza segreti reali esiste
  `ALLOW_INSECURE_CONFIG=true`. Non impostarla su un deploy reale.

Sessione: il cookie contiene solo l'id utente; ruolo e stato vengono letti dal database
e tenuti in cache per istanza per 30 secondi (`SESSION_USER_CACHE_TTL_MS`, `0` per
disattivare). Approvazioni, cambi di ruolo ed eliminazioni fatti dall'app invalidano
subito la cache dell'istanza che li esegue; le altre istanze si allineano entro il TTL.

Altre protezioni: il login è limitato a 10 tentativi falliti per email e 30 per IP
ogni 15 minuti (risposta `429` con `Retry-After`; il blocco di un'email scade da solo
e non invalida le sessioni già aperte). Ogni istruzione eseguita dalla console SQL
admin viene registrata nella tabella `admin_audit_log` (utente, istruzione, esito,
durata) **prima** dell'esecuzione: se la scrittura del log fallisce, l'istruzione non
viene eseguita.

## Deploy su Vercel

Zero-config (`vercel.json` → framework `nextjs`). Per la persistenza aggiungere
un database **Neon** (Vercel Marketplace) e impostare `UPLOAD_SECRET`
(`DATABASE_URL` viene iniettata dall'integrazione Neon).
