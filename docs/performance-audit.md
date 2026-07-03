# Audit performance & perceived speed — Dashboard ARIA SISS L2

Data audit: 2026-07-03 · Stack: Next.js 14 (App Router) · React 18 · TypeScript 5 · Tailwind CSS 3 · Neon (driver neon-http) · Vercel

## Fase 1 — Risultati dell'audit

### Contesto architetturale

- Tutte le pagine dati (`/dashboard`, `/admin/*`, `/upload`) sono `force-dynamic` con fetch server-side; il client riceve l'intero payload via SSR e non rifetcha (mutazioni ottimistiche + `router.refresh()`).
- Il driver **neon-http è stateless: ogni query è una richiesta HTTPS** — il costo dominante lato server è il numero di round-trip, non il peso delle singole query.
- Bundle già snello in partenza (~118 kB first-load JS): niente librerie di charting (SVG generato a mano), `xlsx` già caricato via dynamic import nel browser solo al momento dell'upload.
- Nessuna immagine raster nel progetto (solo emoji/SVG inline) → la categoria "immagini" non è applicabile.

### Tabella prioritizzata (ordinata per rapporto impatto/effort)

| # | Problema | Categoria | Impatto | Effort | Priorità |
|---|----------|-----------|---------|--------|----------|
| 1 | Google Fonts caricati con `<link>` render-blocking (catena googleapis → gstatic, FOUT, nessun preload) | Bundle/Asset | Alto | S | P1 |
| 2 | Nessun `loading.tsx`: pagina bianca al primo caricamento, UI "congelata" nelle navigazioni client (nessun feedback fino a fine SSR) | UX | Alto | S | P1 |
| 3 | Waterfall auth → dati: `getSessionUser()` (query utente) awaited **prima** di far partire le query dati su tutte le pagine SSR | Rete | Medio | S | P1 |
| 4 | `getDashboardData`: 10 query per render, di cui 2 duplicate (config `rti` letta due volte; `bef_records` letta due volte) e 5 letture singole di `app_config` batchabili in una | Rete/DB | Medio | M | P1 |
| 5 | Upload Excel: upsert riga-per-riga = 2 round-trip HTTP sequenziali per riga (N+1); centinaia di righe ⇒ decine di secondi | Rete/DB | Alto (flusso upload) | M | P2 |
| 6 | `/` fa redirect via lambda invece che a livello CDN/edge | Rete | Basso | S | P2 |
| 7 | FilterBar: 7 scansioni facet dell'intera lista ricalcolate a ogni re-render del parent (toast, saving flags…) senza `useMemo`; nessun `React.memo` | Render | Medio | S | P2 |
| 8 | Pannelli non memoizzati + callback inline (`onOpenEdit`, `onDrillMod`…) ricreate a ogni render ⇒ re-render dei chart SVG a ogni cambio di stato del parent | Render | Medio | S | P2 |
| 9 | Ricerca del registro Operativo sincrona a ogni keystroke (filtra+ordina l'intera lista nel render) | Render | Medio | S | P2 |
| 10 | Loading state testuali ("Caricamento…") negli editor admin (Risorse, BEF, Database) e nel fallback della login: nessuna skeleton, contenuto che "salta" | UX | Medio | S | P2 |
| 11 | Login: il bottone esce dallo stato busy prima che la dashboard sia caricata ⇒ l'app sembra ferma durante la navigazione post-login | UX | Medio | S | P2 |
| 12 | Gestione utenti: azioni non ottimistiche (attesa server per approvazione/ruolo/eliminazione) | UX | Basso | S | P3 |
| 13 | `bef_records.numero_if` e `if_risorse.numero_if` senza indice (lookup per-IF negli editor admin) | DB | Basso | S | P3 |
| 14 | `X-Powered-By` header inviato (byte inutili + fingerprinting) | Rete | Basso | S | P3 |
| 15 | Bootstrap DDL: ~28 statement sequenziali a ogni cold start della lambda | DB | Medio | L | P3 (fuori scope, v. sotto) |
| 16 | Cache SSR del payload dashboard (`unstable_cache` + tag revalidation sulle mutazioni) | Rete | Medio | L | P3 (fuori scope) |

**Quick win (impatto Alto, effort S):** #1, #2, #3.

### Percezione per schermata (stato PRIMA dell'intervento)

| Flusso | Cosa vedeva l'utente |
|--------|----------------------|
| Primo caricamento `/dashboard` | Pagina bianca finché sessione + 10 query non completano |
| Navigazione client (upload → dashboard, login → dashboard) | Pagina precedente congelata, nessun indicatore |
| Cambio tab | ✅ già ok: `useTransition` + spinner contestuale |
| Modifica inline / delete registro | ✅ già ottimistico con rollback + toast |
| Salvataggio drawer | ✅ bottone "Salvataggio…" disabilitato |
| Upload Excel | ✅ progress bar per fasi + bottone busy |
| Editor admin (Risorse/BEF/DB) | Testo "Caricamento…" senza forma del contenuto |
| Gestione utenti | Riga sbiadita in attesa del server (non ottimistico) |
| Stati vuoti / errori | ✅ già ben curati (emptystate, fempty, messaggi con azione) |

## Fase 2 — Interventi implementati

Vedi il riepilogo nella PR. In sintesi: font self-hosted via `next/font` (#1, #14); skeleton streaming per le 4 route dinamiche con shimmer, `role="status"`, `aria-busy` e dimensioni identiche al contenuto reale (#2, #10); parallelizzazione auth‖dati (#3); `getSettingsBulk` + dedup query BEF/quota: 10 → 4 round-trip per render della dashboard (#4); upsert upload batchato: 1 lettura + insert batch + update in chunk paralleli (#5); redirect edge per `/` (#6); memoizzazione FilterBar/pannelli + callback stabili (#7, #8); `useDeferredValue` sulla ricerca del registro (#9); login busy fino a fine navigazione (#11); gestione utenti ottimistica con rollback (#12); indici su `numero_if` (#13).

### Fuori scope (e perché)

- **#15 bootstrap DDL su cold start**: richiederebbe un meccanismo di versioning dello schema (probe + skip); rischio di regressione sull'auto-provisioning che oggi garantisce il funzionamento su DB vergine. Suggerito per un secondo round: sentinella `schema_version` in `app_config` per saltare l'intero blocco DDL quando aggiornato.
- **#16 cache del payload SSR**: i dati cambiano solo su mutazione esplicita, quindi `unstable_cache` + `revalidateTag` su tutti i path di scrittura (upload, PUT/POST/DELETE interventi, admin) porterebbe il TTFB della dashboard vicino a zero; è però un cambio trasversale a ogni route di mutazione, da fare con test dedicati.
- **Virtualizzazione del registro**: il portafoglio è di poche decine/centinaia di righe; con `useDeferredValue` la ricerca resta fluida. Da rivalutare solo se il registro supererà ~2.000 righe.
- **nprogress / barra di navigazione globale**: sostituita dal pattern nativo App Router (skeleton streaming via `loading.tsx`), che dà feedback più ricco della barra e mantiene il layout stabile. L'App Router non espone route events affidabili per nprogress senza patchare `history`.
