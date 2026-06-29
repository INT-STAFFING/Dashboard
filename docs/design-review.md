# Design Review — Dashboard ARIA SISS L2

> Documento di **validazione della progettazione** redatto in ottica Product Design
> Senior (UX research · information architecture · design system).
> Approccio critico/Socratico: l'obiettivo non è confermare le scelte fatte ma
> far emergere assunzioni deboli, gap e punti ciechi prima di proseguire lo
> sviluppo.
>
> **Stato prodotto analizzato:** applicazione Next.js 14 già matura e in
> produzione (CIG SISS L2, RTI 7-26, mandataria Intellera, partner Deloitte).
> **Data review:** 2026-06-29.

---

## 0. Cosa fa davvero lo strumento (analisi del codice)

Prima di validare, ho ricostruito le funzionalità dal codice (`app/`,
`components/`, `lib/`), non dalle intenzioni dichiarate.

**Dominio.** È un *executive monitor* mono-contratto per il presidio degli
**Interventi di Fornitura (IF)** e dei relativi **Buoni d'Ordine (BO)** erogati
dal RTI verso **ARIA Lombardia** (Sistema Informativo Socio-Sanitario, L2). Non
è un gestionale generico: è cucito su un singolo contratto pubblico.

**Capacità effettive (verificate nel codice):**

| Area | Implementazione | File chiave |
|---|---|---|
| Autenticazione | login/registrazione, cookie HMAC, middleware Edge | `lib/auth/*`, `middleware.ts` |
| Ruoli | `ADMIN` / `USERPLUS` / `USER` + workflow `pending→approved/rejected` | `lib/auth/permissions.ts` |
| 7 pannelli | Overview, Quote RTI, Timeline, Distribuzione, Modalità, Stato IF/BO, Operativo | `components/panels/*` |
| Filtri | faceted (conteggi live, opzioni a 0 disabilitate), pill rimovibili, empty-state | `components/FilterBar.tsx` |
| Editing | inline click-to-edit + drawer completo, ottimistico, `edited_manually` merge-safe | `components/editing/*`, `Dashboard.tsx` |
| Upload Excel | merge-aware, riconoscimento per nome file, parse client-side per file >4.5MB | `app/api/upload/route.ts`, `lib/parsers/*` |
| Admin | gestione utenti + gestione dati (gara, tariffe, risorse, timeline) | `app/admin/*`, `components/AdminGestione.tsx` |
| Export | CSV del registro IF | `components/panels/RegistroPanel.tsx` |
| Persistenza | Drizzle + Neon Postgres, fallback in-memory a zero config | `lib/store.ts`, `lib/db.ts` |

**Regole di dominio dei codici** (fonte: business owner — codificate in `lib/codes.ts`):

| Codice | Formato | Struttura | Note |
|---|---|---|---|
| **IF** (Intervento di Fornitura) | 8 cifre | `AAAAXXXX` | AAAA = anno, XXXX = progressivo |
| **BDO** (Buono d'Ordine) | 10 cifre | `AAAA33XXXX` | "33" costante; generato dopo l'IF e collegato a esso |
| **BEF** (rendicontazione) | 20 cifre | `AAMMBBBBBBBBBBXXXXXX` | AA=anno, MM=mese, `BBBBBBBBBB`=BDO rendicontato, XXXXXX=progressivo |

Conseguenza di design: **dal BEF si risale sempre al BDO** (posizioni 5–14) e
**dal BDO all'IF** (`intervento.bdo`). È la catena usata per agganciare la
rendicontazione BEF al portafoglio in fase di upload (F-3).

**Assunzione implicita n.1 (da sfidare):** l'app assume *un solo contratto, due
partner noti (Intellera/Deloitte), anno fiscale 2026 cablato* (`revenue_2026`,
`rev_mesi[12]` Gen–Dic). Questo è un vincolo di progettazione fortissimo,
mai dichiarato come requisito esplicito.

---

## 1. Personas

Le personas sono derivate dai **ruoli reali del codice** e dal dominio (RTI su
commessa PA sanitaria), non da archetipi generici. Ogni persona è ancorata a un
comportamento osservabile e a una metrica di successo.

### P1 — Marco, Program Manager RTI (mandataria Intellera) · `USERPLUS`
- **Contesto:** responsabile della commessa SISS L2 lato RTI. Risponde al
  cliente ARIA e ai partner del consorzio.
- **Job-to-be-done:** «Ogni lunedì devo sapere quanti IF sono senza BO (non
  fatturabili), quanto massimale RTI ho eroso e se sforo una quota partner.»
- **Comportamenti reali:** apre la Overview, poi "Stato IF/BO → Da presidiare",
  esporta il CSV per il meeting. Modifica inline lo stato di un BO appena
  approvato.
- **Frustrazione:** dati Excel che arrivano da fonti diverse (aggregatore,
  cruscotto revenue) e non combaciano.
- **Successo:** zero IF "dimenticati" senza BO; erosione quota sotto soglia.

### P2 — Giulia, PMO / Controllo di gestione · `USERPLUS`
- **Contesto:** tiene allineati i dati. È lei che carica gli Excel e corregge a
  mano i record.
- **Job-to-be-done:** «Carico l'aggregatore aggiornato senza perdere le note e
  le correzioni che ho fatto a mano la settimana scorsa.»
- **Comportamenti reali:** usa `/upload`, si fida del merge `edited_manually`,
  usa il drawer per compilare PDC/verbali/BEF.
- **Frustrazione:** non sa *quali* record sono stati protetti dal merge né *cosa*
  ha cambiato l'ultimo upload (manca un diff/log visibile).
- **Successo:** un upload non distrugge mai lavoro manuale; capisce cosa è
  cambiato.

### P3 — Avv./Dott. Bianchi, Sponsor esecutivo (partner Deloitte) · `USER`
- **Contesto:** legge, non scrive. Vuole il quadro economico in 30 secondi, spesso
  da tablet in riunione.
- **Job-to-be-done:** «Qual è la nostra quota erosa e la revenue cumulata a oggi?»
- **Comportamenti reali:** filtra per fornitore = Deloitte, guarda KPI e donut
  Quote RTI. Non tocca l'editing.
- **Frustrazione:** troppe colonne/numeri; vuole il dato sintetico e affidabile.
- **Successo:** legge il dato giusto senza chiedere a nessuno; si fida.

### P4 — Sara, Amministratrice di sistema · `ADMIN`
- **Contesto:** governa accessi e dati di base (tariffe, gara, massimale RTI).
- **Job-to-be-done:** «Approvo le registrazioni, assegno i ruoli, sistemo i
  parametri di gara quando cambia un atto aggiuntivo.»
- **Comportamenti reali:** `/admin/users`, `/admin/gestione`. È l'unica che vede
  tutto.
- **Frustrazione:** nessun audit di *chi* ha cambiato *cosa* e *quando* oltre a un
  singolo `last_edited_by`.
- **Successo:** accessi corretti; nessun dato di gara errato in dashboard.

### P5 — Referente ARIA (cliente/stakeholder esterno) — *persona di confine, NON utente*
- **Contesto:** non ha accesso, ma il suo nome (`ref_aria`) è un asse di analisi.
- **Perché conta:** il prodotto è progettato *attorno* alla relazione con ARIA.
  Decisioni come "cosa esporto / cosa mostro in riunione col cliente" dipendono
  da lui. Esplicitarlo evita di confondere *soggetto del dato* e *utente del
  sistema* — errore frequente in dashboard B2G.

> **Nota critica:** le persone P1–P4 mappano 1:1 sui ruoli tecnici. È comodo ma
> sospetto: i ruoli sono `ADMIN/USERPLUS/USER`, cioè *livelli di permesso*, non
> *job function*. Un controllo di gestione e un program manager hanno lo stesso
> permesso `USERPLUS` ma bisogni diversi. **Vedi Audit §FASE 1.2.**

---

## 2. User Stories

Formato: `Come <persona> voglio <azione> così che <valore>`. Priorità MoSCoW.
✅ = già coperta dal codice · ⚠️ = parziale · ❌ = gap (vedi Audit).

### Epica A — Visione direzionale
- **US-A1** ✅ (Must) Come P1 voglio vedere KPI di portafoglio (n° IF, valore,
  BO emessi, quota erosa) così che colga lo stato in 10s. — *OverviewPanel*
- **US-A2** ✅ (Must) Come P3 voglio la revenue mensile e cumulata 2026 così che
  valuti l'avanzamento economico. — *chartMonthly*
- **US-A3** ⚠️ (Should) Come P1 voglio confrontare revenue *di competenza* vs
  *consuntivato (cons_mesi)* così che veda lo scostamento. — *dati presenti
  (`cons_mesi`), Timeline li usa, ma la Overview no.*

### Epica B — Presidio operativo IF/BO
- **US-B1** ✅ (Must) Come P1 voglio l'elenco degli IF senza BO così che sblocchi
  la fatturazione. — *StatoPanel "Da presidiare"*
- **US-B2** ✅ (Must) Come P2 voglio modificare inline stato/PDC/verbali/date così
  che aggiorni senza ricaricare un Excel. — *RegistroPanel + InlineField*
- **US-B3** ✅ (Should) Come P2 voglio un form completo (drawer) per un IF così che
  compili tutti i campi. — *EditDrawer*
- **US-B4** ✅ (Could) Come P1 voglio fare drill-down da grafico a registro
  filtrato così che dal numero arrivi al dettaglio. — *drillTo()*
- **US-B5** ❌ (Should) Come P2 voglio sapere *quali campi/righe* ha cambiato
  l'ultimo upload così che validi l'import. — **GAP: nessun diff/log import.**
- **US-B6** ❌ (Could) Come P2 voglio annullare un'eliminazione (undo soft-delete)
  così che recuperi un IF cancellato per errore. — **GAP: nessuna UI di restore.**

### Epica C — Quote RTI e rischio massimale
- **US-C1** ✅ (Must) Come P1 voglio vedere erosione massimale e quote per partner
  così che eviti lo sforamento. — *RTIPanel*
- **US-C2** ✅ (Should) Come P4 voglio editare massimale/quote RTI così che rifletta
  l'atto contrattuale. — *onUpdateRti*
- **US-C3** ❌ (Should) Come P1 voglio un **alert** quando l'erosione supera una
  soglia (es. 80/90%) così che agisca prima. — **GAP: la barra mostra % ma non
  segnala soglia di rischio.**

### Epica D — Data ingestion & qualità dato
- **US-D1** ✅ (Must) Come P2 voglio caricare l'Excel e fare upsert merge-aware
  così che non perda le correzioni manuali. — *upload route*
- **US-D2** ⚠️ (Must) Come P2 voglio che i dati BEF e Chiusura caricati vengano
  **salvati** così che alimentino l'analisi. — **CONTRADDIZIONE: il codice li
  legge ma li scarta (`non persistite`). Vedi Audit §3.**
- **US-D3** ❌ (Should) Come P2 voglio capire *perché* un file è stato rifiutato
  (tipo non riconosciuto) con esempi di naming così che lo rinomini. — *messaggio
  c'è ma non guida (manca esempio concreto del nome atteso).* ⚠️

### Epica E — Accessi & governance
- **US-E1** ✅ (Must) Come P4 voglio approvare/rifiutare registrazioni e assegnare
  ruoli. — *UsersAdmin*
- **US-E2** ✅ (Must) Come P4 voglio gestire i dati di gara/tariffe/risorse. —
  *AdminGestione*
- **US-E3** ❌ (Should) Come P4 voglio un **audit trail** (chi/cosa/quando) così che
  ricostruisca le modifiche. — **GAP: solo `last_edited_by/at` singolo.**

### Epica F — Fruizione & accessibilità *(trasversale)*
- **US-F1** ✅ Come P3 voglio leggere la dashboard da tablet in riunione. — *layout
  responsive presente* ⚠️ *(da verificare su grafici SVG e tabella larga).*
- **US-F2** ❌ (Must per commessa PA) Come utente che naviga da tastiera/screen
  reader voglio usare tab, grafici e tabella in modo accessibile così che la
  dashboard sia **conforme AgID/WCAG 2.1 AA** (requisito di legge per fornitori
  PA). — **GAP: tablist senza semantica ARIA/keyboard; grafici SVG senza
  alternativa testuale. Vedi Audit §3 + sviluppo applicato.**

---

## 3. User Journey

### Journey 1 — «Lunedì mattina» (P1, Program Manager)
1. **Trigger:** stand-up settimanale alle 9:00.
2. Login → redirect `/dashboard`. *(Emozione: 😐 fretta)*
3. Overview: legge IF attive, valore, BO emessi, **quota erosa**. *(😀 colpo
   d'occhio ok)*
4. Tab "Stato IF/BO" → lista "Da presidiare". *(😟 trova 4 IF senza BO)*
5. Filtra Fornitore = Intellera per capire di chi sono. *(🙂)*
6. Tab "Operativo" → Esporta CSV per il meeting. *(😀)*
7. **Punto di attrito:** non sa se i dati sono freschi (ultimo upload quando?).
   Vede solo "agg. <data generato>" in header — è la data del file, non
   dell'ultima modifica manuale. *(😕 dubbio sulla freschezza)*

### Journey 2 — «Carico i dati nuovi» (P2, PMO)
1. **Trigger:** arriva l'aggregatore Modulo 106 aggiornato via email.
2. `/upload`, drag del file. *(🙂)*
3. Sistema riconosce il tipo dal nome. *(😀)*
4. Esito: "X inseriti, Y aggiornati, Z saltati". *(😐)*
5. **Attrito 1:** "Z saltati" = record protetti da `edited_manually`, ma non sa
   *quali*. *(😟)*
6. **Attrito 2:** carica anche il BEF → messaggio "righe lette (non persistite)".
   Pensa di aver importato dati che invece spariscono. *(😠 grave: falso
   successo)*
7. Torna in dashboard, verifica a mano. *(😕 lavoro doppio)*

### Journey 3 — «Lettura esecutiva da tablet» (P3, Sponsor)
1. **Trigger:** in riunione col cliente, apre da iPad.
2. Login. Filtra Fornitore = Deloitte. *(🙂)*
3. Guarda KPI + donut Quote RTI. *(😀)*
4. **Attrito:** tabella Operativo larga → scroll orizzontale scomodo su touch;
   grafici SVG non leggibili da VoiceOver se servisse. *(😕)*

### Journey 4 — «Nuovo collega chiede accesso» (P4, Admin + nuovo USER)
1. Nuovo collega si registra `/register` → stato `pending`.
2. **Attrito:** il nuovo utente vede una schermata di attesa, ma l'admin **non
   riceve notifica**: scopre la richiesta solo se entra in `/admin/users`. *(😟
   latenza di approvazione)*
3. Admin approva, assegna ruolo. Collega entra. *(😀)*

---

## 4. Wireframe / Flussi (testuali)

### 4.1 Mappa dell'Information Architecture
```
/login ─┬─ (no sessione) ──────────────► /login · /register
        └─ (sessione valida) ──────────► /dashboard
/dashboard
  ├─ Header: titolo · CIG · agg. · userchip(ruolo) · [Modifica] [Carica] [Gestione] [Utenti] [Esci]
  ├─ Tabbar (7): Overview · Quote RTI · Timeline · Distribuzione · Modalità · Stato IF/BO · Operativo
  ├─ FilterBar (globale, si applica a tutte le viste)
  └─ Panel attivo
/upload                (USERPLUS/ADMIN)  → drag&drop + esito import
/admin/users           (ADMIN)           → approvazioni, ruoli, delete
/admin/gestione        (ADMIN)           → gara, tariffe, risorse, timeline, BEF
```

### 4.2 Flusso «Upload merge-aware» (target, con fix US-D2/US-B5)
```
[Seleziona file] → riconosci tipo (nome→contenuto)
   │ unknown → ERRORE 422 con esempio nome corretto ("Aggregatore_2026.xlsx")
   ▼
[Parse] → preview: N record, di cui M già esistenti
   │
   ▼
[Conferma] → upsert
   ▼
[Esito] inseriti / aggiornati / SALTATI(protetti) ──► [Mostra dettaglio righe saltate]  ← FIX US-B5
   └─ BEF/Chiusura → SALVATE in tabella, non scartate                                    ← FIX US-D2
```

### 4.3 Wireframe Overview (ASCII)
```
┌ Overview & KPI ─────────────────────────────────────────────┐
│ [IF attive 24] [Valore 12,3M] [BO 18/24 ▓▓▓░] [Quota 62% ▓▓] │  ← +badge soglia rischio (FIX US-C3)
│ ┌ Revenue mensile 2026 ──────────────────────────────────┐  │
│ │  ▁▂▃▅▆▇  + linea cumulato + marker mese corrente        │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌ Indicatori sintetici ─────────────────────────────────┐   │
│ │ Valore · Revenue anno · Rev. YTD · BO · Quota erosa    │   │
│ └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## FASE 1 — Audit della progettazione

### 1.1 Coerenza — le user stories coprono i flussi critici?
**Verdetto: coperti i flussi core, ma 3 contraddizioni/gap critici.**

- ✅ I flussi *visione → presidio → editing → export* sono completi e coerenti.
- ❌ **C1 (contraddizione dato).** BEF e Chiusura: l'upload li *legge* ma
  dichiara "non persistite" (`app/api/upload/route.ts:94-99`). La schema ha le
  tabelle `bef_records` e `verbali_chiusura`, e l'admin ha editing BEF
  (`/api/admin/bef/[num_if]`). **Quindi un canale (upload) scarta dati che un
  altro canale (admin) gestisce.** Incoerenza di prodotto, non solo tecnica.
  → *Aggiornata US-D2 a stato ⚠️/❌.*
- ❌ **C2 (falso feedback).** L'esito upload conta i "saltati" ma non li espone:
  l'utente non può validare l'import. → *Aggiunta US-B5.*
- ❌ **C3 (rischio non segnalato).** L'erosione quota è mostrata come numero/barra
  ma senza soglia/alert: il valore di prodotto ("evita lo sforamento") non è
  servito fino in fondo. → *Aggiunta US-C3.*
- ⚠️ **C4 (accessibilità).** Per un fornitore PA la conformità AgID/WCAG 2.1 AA
  è un requisito normativo, non un nice-to-have, e non era tra le user stories.
  → *Aggiunta US-F2 (Must).*

**Azione fatta:** le user stories §2 sono state **aggiornate** con US-B5, US-B6,
US-C3, US-D2 (riclassificata), US-E3, US-F2.

### 1.2 Utente — le personas sono concrete o stereotipi?
**Verdetto: erano a rischio stereotipo perché clonavano i ruoli tecnici.**

- Problema individuato: mappare 1:1 persona↔ruolo confonde *permesso* e *job*.
  Due `USERPLUS` (Program Manager vs PMO/Controllo) hanno bisogni divergenti.
- **Azione fatta:** le personas §1 sono state rese concrete con JTBD, comportamenti
  osservabili, frustrazioni e metrica di successo; ho separato P1 (PM) e P2 (PMO)
  pur avendo lo stesso ruolo, e aggiunto P5 (referente ARIA) come *persona di
  confine non-utente* per non confondere soggetto-del-dato e utente.
- Punto cieco residuo: **nessuna evidenza di ricerca reale** dietro le personas
  (sono inference dal dominio/codice). Vanno validate con 3–4 interviste. → vedi
  FASE 3, RQ-1.

### 1.3 Edge cases non considerati
1. **Portafoglio vuoto reale** (0 IF in DB, non filtrati): la Overview mostra
   `0%`, divisioni protette (`IFs.length ? …`) ok, ma manca un *empty-state
   globale di primo avvio* ("nessun dato: carica un Excel").
2. **Anno fiscale ≠ 2026.** Campi `revenue_2026`, label "2026" cablati. A gennaio
   2027 la dashboard mente. → rischio alto, vita del contratto pluriennale.
3. **Quota partner sforata (>100%).** La barra fa `Math.min(100, eroPct)`: lo
   sforamento è invisibile proprio quando è più importante.
4. **Upload concorrente** (P2 e admin caricano insieme): nessun lock; last-write
   wins silenzioso.
5. **Sessione scaduta durante editing ottimistico:** l'UI mostra il salvataggio,
   il PUT torna 401, rollback + toast — ok, ma il toast non dice "rifai login".
6. **CSV con separatore/locale:** export usa `;` e virgola decimale (corretto per
   Excel IT) ma BOM + encoding vanno verificati su Excel EN.
7. **Subappaltatore lista vuota ma flag true:** `StatoPanel` gestisce, ok.
8. **Numero IF duplicato in upload:** unique constraint → l'upsert dovrebbe
   aggiornare; da verificare il comportamento su collisione di chiave naturale.
9. **Ruolo cambiato mentre l'utente è loggato:** il permesso è valutato a ogni
   request? (middleware) — da verificare per revoca immediata.
10. **Date invalide / fine < inizio:** nessuna validazione cross-field nel drawer.

---

## FASE 2 — 10 domande di stress test (design review)

1. **Mono-contratto:** avete cablato anno 2026 e due partner. Cosa succede al
   rinnovo/atto aggiuntivo o a un secondo lotto? È una scelta o un debito?
2. **Fonte di verità:** se l'Excel aggregatore e le correzioni manuali divergono,
   *chi vince* e come fa l'utente a *sapere* che ha vinto? Dov'è il diff?
3. **BEF/Chiusura scartati:** perché esistono tabelle e editing admin per dati
   che l'upload butta via? Qual è il modello mentale dell'utente qui?
4. **Erosione quota:** mostrate la %, ma qual è la *soglia d'azione*? Senza alert,
   il KPI è informativo o decisionale? Come si misura che ha evitato uno sforo?
5. **Personas vs permessi:** avete personas o avete ridisegnato i 3 ruoli tecnici?
   Quante interviste reali ci sono dietro?
6. **Trust del numero:** uno sponsor legge "Quota 62%" in riunione col cliente.
   Da dove viene quel 62%? È riconciliato? Cosa succede se è sbagliato davanti
   ad ARIA?
7. **Accessibilità PA:** siete fornitori di una PA. Dov'è la dichiarazione di
   accessibilità AgID? I grafici SVG hanno alternative testuali? La tabella è
   navigabile da tastiera?
8. **Freschezza dato:** l'header dice "agg. <data>". È la data del *file* o
   dell'*ultima modifica*? L'utente sa quanto è vecchio ciò che guarda?
9. **Audit & compliance:** su una commessa pubblica, sapete ricostruire chi ha
   cambiato un importo e quando? `last_edited_by` singolo basta in caso di
   contestazione?
10. **Onboarding & vuoto:** cosa vede il primo admin al primo avvio, DB vuoto?
    E un nuovo utente in `pending` quanto aspetta — l'admin viene avvisato?

---

## FASE 3 — Suggerimenti concreti (ricerca + azione)

Per ogni criticità: una **domanda di ricerca (RQ)** o un'**azione (ACT)**.

| ID | Criticità | Tipo | Proposta | Stato |
|----|-----------|------|----------|-------|
| F-1 | Personas non validate | RQ-1 | 3–4 interviste a PM/PMO/sponsor reali per validare JTBD e priorità. | aperto (richiede utenti reali) |
| F-2 | Anno fiscale cablato | RQ-2 + ACT | Confermare durata contratto; parametrizzare anno/etichette mesi via `app_config`. | aperto (decisione di prodotto) |
| F-3 | BEF/Chiusura scartati (C1/US-D2) | ACT | Persistere su upload (BEF: linking `num_bdo→bdo→IF`, upsert per fattura). Chiusura rimandata (manca superficie UI). | **FATTO (BEF)** · Chiusura a backlog |
| F-4 | Esito import opaco (C2/US-B5) | ACT | Esporre elenco righe saltate/aggiornate. | **FATTO** |
| F-5 | Erosione senza alert (C3/US-C3) | ACT | Badge soglia rischio sulla KPI quota. | **FATTO** |
| F-6 | Accessibilità tablist/grafici (C4/US-F2) | ACT | **Tablist ARIA + navigazione tastiera + alt testuale grafici.** | **FATTO** |
| F-7 | Sforamento >100% invisibile | ACT | Mostrare valore reale + stato "oltre soglia" quando >100%. | **FATTO** |
| F-8 | Freschezza dato ambigua | RQ-3 | Distinguere "dati al" (file) da "ultima modifica". | **FATTO** |
| F-9 | Empty-state globale primo avvio | ACT | Schermo "nessun dato, carica Excel". | **FATTO** |

**Sviluppo applicato in questa iterazione (F-6):** accessibilità della
navigazione a tab — requisito *Must* perché normativo per fornitori PA (AgID /
WCAG 2.1 AA, US-F2). Scelto come primo intervento perché:
(a) alto valore/legale, (b) basso rischio di regressione, (c) sblocca P3 (tablet/
screen reader) e qualunque audit di accessibilità del cliente.

Dettaglio modifica: la `<nav class="tabbar">` è ora un **tablist ARIA** completo
(`role="tablist"`, ogni tab `role="tab"` con `aria-selected` e `tabindex`
roving), naviga da tastiera con **←/→/Home/End**, e ogni pannello è
`role="tabpanel"` collegato al proprio tab via `aria-labelledby`/`aria-controls`.

> Dopo F-6 ho **rieseguito l'audit** (vedi §"Re-audit") aggiornando lo stato di
> US-F2.

### Re-audit (dopo F-6)
- **1.1 Coerenza:** invariata salvo US-F2 ora ✅ per la parte navigazione a tab
  (grafici SVG: alternativa testuale resta backlog → US-F2 ⚠️ parziale).
- **1.2 Utente:** P3 (tablet/screen reader) ora parzialmente servita.
- **1.3 Edge case:** nessuna regressione introdotta; build verificata.

---

## FASE 4 — Checklist di review (gate verso lo sviluppo)

Da verificare **sistematicamente** prima di considerare chiusa una iterazione di
sviluppo. Stato: ✅ fatto · ⬜ aperto/backlog · 🔬 richiede ricerca utente.

### Progettazione & coerenza
- [✅] Funzionalità ricostruite dal codice (non dalle intenzioni)
- [✅] Personas concrete (JTBD + comportamenti + successo), non cloni dei ruoli
- [✅] User stories mappate al codice con stato (✅/⚠️/❌) e MoSCoW
- [✅] User journey con punti di attrito espliciti
- [✅] Contraddizioni di prodotto identificate (BEF scartati, import opaco, quota)
- [🔬] Personas validate con utenti reali (RQ-1)

### Qualità del dato
- [✅] BEF: persistenza su upload con linking `num_bdo→bdo→IF` e upsert per fattura (F-3)
- [⬜] Chiusura: persistenza + superficie UI (F-3 residuo — manca dove mostrarla)
- [✅] Esito import mostra righe inserite/aggiornate/preservate (F-4)
- [✅] Distinzione "dati al" vs "ultima modifica" (F-8)
- [✅] Validazione cross-field date (fine ≥ inizio) nel drawer

### Decisione & rischio
- [✅] Alert soglia erosione quota (F-5)
- [✅] Sforamento >100% reso visibile (F-7)

### Accessibilità (AgID/WCAG 2.1 AA — Must PA)
- [✅] Tablist ARIA + navigazione tastiera (←/→/Home/End) (F-6)
- [✅] Pannelli `role="tabpanel"` collegati ai tab
- [✅] Alternativa testuale ai grafici SVG principali (US-F2: revenue mensile, donut RTI, erosione per anno, donut stato BO)
- [⬜] Verifica contrasto colori palette (petrol/gold) AA
- [⬜] Tabella Operativo navigabile/utilizzabile da tastiera e touch

### Robustezza / edge case
- [✅] Divisioni protette su portafoglio vuoto (verificato nel codice)
- [✅] Empty-state globale primo avvio (F-9)
- [✅] Messaggio sessione scaduta durante editing ("rifai login")
- [⬜] Comportamento upload concorrente / collisione chiave naturale
- [⬜] Anno fiscale parametrizzato (F-2 — decisione di prodotto)

### Build & verifica
- [✅] `next build` verde dopo le modifiche

---

## Sintesi esecutiva

L'applicazione è **solida e matura** nei flussi core (visione, presidio,
editing, upload merge-aware). I rischi maggiori **non sono bug** ma *gap di
progettazione di prodotto*:
1. **Coerenza del dato** (BEF/Chiusura scartati, import opaco) — mina la fiducia.
2. **Da KPI a decisione** (erosione senza soglia/alert) — il dato informa ma non
   guida l'azione.
3. **Conformità PA** (accessibilità) — requisito normativo: **prima azione
   sviluppata in questa iterazione (F-6)**.
4. **Assunzioni cablate** (anno 2026, due partner) — debito da decidere
   consapevolmente.

La checklist FASE 4 è il gate da verificare a ogni iterazione successiva.
</content>
</invoke>
