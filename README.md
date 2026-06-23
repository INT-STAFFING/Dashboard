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
- **Drizzle ORM** + **Vercel Postgres** (con fallback in-memory a zero config)

## Avvio locale

```bash
npm install
npm run dev          # http://localhost:3000 → /dashboard
```

Senza `POSTGRES_URL` l'app usa automaticamente un **seed in memoria** (24
interventi, estratti dalla dashboard originale): build e demo funzionano subito.
Con `POSTGRES_URL` configurato usa Vercel Postgres in modo persistente.

```bash
cp .env.example .env.local        # imposta POSTGRES_URL e UPLOAD_SECRET
npm run db:push                   # crea le tabelle (Drizzle)
npm run db:seed                   # popola con il portafoglio baseline
```

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
  parsers/                      parseIF · parseBEF · parseChiusura · parseAggregatore
  queries.ts  charts.ts  format.ts
components/
  Dashboard.tsx  FilterBar.tsx
  panels/        Overview · RTI · Timeline · Distribuzione · Modalità · Stato · Operativo
  editing/       EditDrawer · InlineField · StatusSelect · NotePreview
```

## Pannelli

1. **Overview & KPI** — KPI card, revenue mensile (barre + cumulato), indicatori
2. **Quote RTI ed erosione** — donut composizione RTI, erosione massimale/quote, config editabile
3. **Timeline finanziaria** — Revenue vs Fatturazione, toggle mensile/trimestrale
4. **Distribuzione IF** — per Ambito · per Referente ARIA · per Seniority (GdL)
5. **Modalità fornitura** — donut/barre per tipologia contrattuale (con drill-down)
6. **Stato IF / BO** — stato BO, IF da presidiare, subappalti (con drill-down)
7. **Operativo (Registro IF)** — tabella completa con **editing inline**, drawer di
   modifica, creazione, soft-delete, ricerca, ordinamento ed **export CSV**

## Editing & merge

- Modifica inline (click-to-edit) e drawer completo → `PUT /api/interventi/[num_if]`
- Creazione → `POST /api/interventi` · Eliminazione soft → `DELETE` (`deleted_at`)
- Ogni modifica da UI imposta `edited_manually = true`: il successivo upload Excel
  **non sovrascrive** i record modificati a mano, salvo `?force=true`.

## Upload

`POST /api/upload` (multipart, campo `file`). Il tipo è riconosciuto dal nome:
`IF_ARIA` · `BEF` · `Chiusura` · `Aggregatore`. Protetto da `UPLOAD_SECRET`
(header `x-upload-secret` o `?token=`). Pagina UI: `/upload`.

## Deploy su Vercel

Zero-config (`vercel.json` → framework `nextjs`). Per la persistenza aggiungere
una Vercel Postgres / Neon e impostare `POSTGRES_URL` e `UPLOAD_SECRET`.
