// Catalogo delle formule di calcolo della dashboard.
//
// Documenta, per ciascuno dei tab "1 Overview", "2 Quote RTI",
// "3 Timeline" e "4 Distribuzione", ogni valore mostrato a schermo con la
// formula effettivamente applicata dal codice e una spiegazione discorsiva.
// È la fonte del pulsante "Esporta formule (CSV)" nella sezione
// Gestione dati › 5 Export. Le formule qui sotto rispecchiano 1:1 la logica
// dei componenti in components/panels/*.tsx e delle librerie lib/queries.ts,
// lib/fiscal.ts, lib/befStore.ts, lib/config.ts.

export type FormulaRow = {
  pagina: string; // Tab della dashboard
  sezione: string; // Card / gruppo di indicatori
  elemento: string; // Valore mostrato (etichetta a schermo)
  formula: string; // Formula effettiva, in notazione leggibile
  spiegazione: string; // Cosa rappresenta e come si legge
  sorgenti: string; // Campi / tabelle da cui deriva
};

// Nota trasversale: in tutta la dashboard "vista corrente" indica l'insieme
// delle IF/BO dopo l'applicazione dei filtri della FilterBar (fornitore,
// referente, ambito, stato, modalità, ecc.). I record con deleted_at
// valorizzato (soft-delete) sono sempre esclusi. `importo` è il valore
// contrattuale della IF; `rev_mesi`/`cons_mesi` sono profili di 12 valori in
// ordine solare (indice 0 = Gennaio … 11 = Dicembre).

export const FORMULA_CATALOG: FormulaRow[] = [
  // =========================================================================
  // 1 — OVERVIEW & KPI
  // =========================================================================
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: 'IF attive',
    formula: 'IF_attive = conteggio(IF nella vista corrente)',
    spiegazione:
      'Numero di Interventi di Fornitura attivi presenti nella vista corrente dopo i filtri.',
    sorgenti: 'interventi (record non cancellati, filtrati)',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: 'Valore IF attive',
    formula: 'tot = Σ importo (su tutte le IF della vista)',
    spiegazione:
      'Somma degli importi contrattuali di tutte le IF della vista. Mostrato in milioni (€ Mln).',
    sorgenti: 'interventi.importo',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: 'Medio per IF',
    formula: 'medio = tot / IF_attive  (0 se non ci sono IF)',
    spiegazione: 'Importo medio per intervento: valore totale diviso il numero di IF.',
    sorgenti: 'interventi.importo',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: 'Referenti ARIA (n°)',
    formula: 'refs = conteggio valori distinti di ref_aria non vuoti',
    spiegazione: 'Numero di referenti ARIA distinti coinvolti nelle IF della vista.',
    sorgenti: 'interventi.ref_aria',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: 'Ambiti (n°)',
    formula:
      "ambs = conteggio valori distinti di ambito, esclusi vuoti e 'Non classificato'",
    spiegazione: 'Numero di macro-ambiti distinti effettivamente classificati nella vista.',
    sorgenti: 'interventi.ambito',
  },
  {
    pagina: '1 Overview',
    sezione: 'Revenue mensile',
    elemento: 'Revenue del mese m',
    formula: 'revM[m] = Σ rev_mesi[m] (su tutte le IF della vista)',
    spiegazione:
      'Revenue di competenza del mese m: somma, su tutte le IF, del valore del mese m nel profilo rev_mesi.',
    sorgenti: 'interventi.rev_mesi[]',
  },
  {
    pagina: '1 Overview',
    sezione: 'Revenue mensile',
    elemento: 'Revenue anno (totale)',
    formula: 'revTot = Σ(m=Gen..Dic) revM[m]',
    spiegazione: "Revenue di competenza dell'intero anno: somma dei 12 valori mensili.",
    sorgenti: 'interventi.rev_mesi[]',
  },
  {
    pagina: '1 Overview',
    sezione: 'Revenue mensile',
    elemento: 'Cumulato al mese m',
    formula: 'cumV[m] = Σ(k=Gen..m) revM[k]',
    spiegazione: 'Curva cumulata: somma progressiva della revenue mensile da gennaio al mese m.',
    sorgenti: 'interventi.rev_mesi[]',
  },
  {
    pagina: '1 Overview',
    sezione: 'Indicatori sintetici',
    elemento: 'Revenue da gennaio ad oggi',
    formula: 'revToDate = Σ(m=Gen..mese_corrente) revM[m]',
    spiegazione:
      'Revenue maturata dai mesi già trascorsi nell’anno solare, incluso il mese corrente (il taglio segue la data odierna).',
    sorgenti: 'interventi.rev_mesi[], data odierna',
  },
  {
    pagina: '1 Overview',
    sezione: 'Indicatori sintetici',
    elemento: 'Avanzamento revenue',
    formula: 'avanzamento% = revToDate / revTot × 100',
    spiegazione: 'Quota della revenue annua già maturata ad oggi.',
    sorgenti: 'interventi.rev_mesi[]',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: 'BO emessi',
    formula: 'conBo = conteggio(IF con has_bo = vero); mostrato come conBo / IF_attive',
    spiegazione: 'Numero di Buoni d’Ordine emessi sul totale delle IF della vista.',
    sorgenti: 'interventi.has_bo',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: '% BO emessi',
    formula: 'pct = arrotonda(conBo / IF_attive × 100)',
    spiegazione: 'Percentuale di IF con Buono d’Ordine emesso. Riempie la barra di avanzamento.',
    sorgenti: 'interventi.has_bo',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI',
    elemento: 'IF da sbloccare',
    formula: 'senzaBo = conteggio(IF con has_bo = falso)',
    spiegazione: 'IF ancora prive di Buono d’Ordine.',
    sorgenti: 'interventi.has_bo',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI — Quota RTI',
    elemento: 'Quota di riferimento',
    formula:
      'quota = quotaVal[fornitore] se è attivo un filtro fornitore con quota, altrimenti rti.ceiling (massimale contrattuale)',
    spiegazione:
      'Denominatore dell’erosione: la quota del partner filtrato oppure, in assenza di filtro, il massimale contrattuale complessivo.',
    sorgenti: 'config RTI (massimale, quote partner), filtro fornitore',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI — Quota RTI',
    elemento: 'Quota RTI impegnata (%)',
    formula: 'eroPct = tot / quota × 100  (0 se quota = 0)',
    spiegazione:
      'Percentuale del massimale (o della quota) già impegnata dagli importi delle IF della vista.',
    sorgenti: 'interventi.importo, config RTI',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI — Quota RTI',
    elemento: 'Classe di rischio erosione',
    formula:
      "livello = 'Oltre quota' se eroPct>100; 'Critico' se ≥90; 'Attenzione' se ≥75; altrimenti 'Sotto soglia'",
    spiegazione:
      'Soglie di prodotto per l’allerta sull’erosione (attenzione ≥75%, critico ≥90%, sforamento >100%). Determina colore e pill del KPI.',
    sorgenti: 'eroPct (EROSION_THRESHOLDS)',
  },
  {
    pagina: '1 Overview',
    sezione: 'KPI — Quota RTI',
    elemento: 'Oltre quota (%)',
    formula: 'oltre% = eroPct − 100  (mostrato solo se eroPct > 100)',
    spiegazione: 'Entità dello sforamento percentuale rispetto alla quota/massimale.',
    sorgenti: 'eroPct',
  },

  // =========================================================================
  // 2 — QUOTE RTI ED EROSIONE
  // =========================================================================
  {
    pagina: '2 Quote RTI',
    sezione: 'Composizione del RTI (donut)',
    elemento: 'Quota € del partner',
    formula: 'quota_p = ceiling × pct_p',
    spiegazione:
      'Valore in € della quota contrattuale di ciascun partner: massimale per la sua percentuale.',
    sorgenti: 'config RTI (massimale, partners[].pct)',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Composizione del RTI (donut)',
    elemento: 'Somma quote %',
    formula: 'Σ pct_p × 100  (atteso = 100%)',
    spiegazione: 'Controllo di quadratura: la somma delle percentuali dei partner deve dare 100%.',
    sorgenti: 'config RTI (partners[].pct)',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione per partner',
    elemento: 'Impegnato per partner',
    formula: 'impByP[p] = Σ importo delle IF con fornitore = p',
    spiegazione:
      'Valore impegnato da ciascun partner: somma degli importi delle IF di quel fornitore nella vista.',
    sorgenti: 'interventi.importo, interventi.fornitore',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione per partner',
    elemento: 'Erosione quota partner (%)',
    formula: 'pc = impByP[p] / quota_p × 100  (0 se quota_p = 0)',
    spiegazione: 'Percentuale di quota del partner già erosa dal suo impegnato.',
    sorgenti: 'interventi.importo, config RTI',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione per anno',
    elemento: 'Anni del contratto',
    formula: 'anni = da anno(meta.contract_date) a anno(meta.valid_to) inclusi',
    spiegazione: 'Intervallo di anni coperto dalla durata contrattuale, usato per l’asse del grafico.',
    sorgenti: 'meta.contract_date, meta.valid_to',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione per anno',
    elemento: 'Budget annuo (linea di riferimento)',
    formula: 'annualQuota = ceiling / numero_anni',
    spiegazione: 'Massimale ripartito uniformemente sugli anni di contratto: budget medio annuo.',
    sorgenti: 'config RTI (massimale), durata contratto',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione per anno',
    elemento: 'Impegnato per anno',
    formula:
      'impByYear[y] = Σ importo delle IF con anno(data_inizio) = y (fallback: primo anno se data_inizio assente)',
    spiegazione:
      'Impegnato distribuito per anno di inizio della IF; le IF senza data di inizio confluiscono nel primo anno.',
    sorgenti: 'interventi.importo, interventi.data_inizio',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione totale',
    elemento: 'Impegnato totale',
    formula: 'totImpegnato = Σ importo (tutte le IF della vista)',
    spiegazione: 'Somma degli importi di tutte le IF della vista.',
    sorgenti: 'interventi.importo',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione totale',
    elemento: 'Erosione massimale (%)',
    formula: 'eroTotPct = totImpegnato / ceiling × 100  (0 se ceiling = 0)',
    spiegazione: 'Percentuale del massimale contrattuale complessivo già impegnata.',
    sorgenti: 'interventi.importo, config RTI (massimale)',
  },
  {
    pagina: '2 Quote RTI',
    sezione: 'Erosione totale',
    elemento: 'Residuo / Sforamento',
    formula: 'residuo = ceiling − totImpegnato;  se < 0 → Sforamento = |residuo|',
    spiegazione:
      'Capienza residua sul massimale; se negativa indica lo sforamento del massimale contrattuale.',
    sorgenti: 'interventi.importo, config RTI (massimale)',
  },

  // =========================================================================
  // 3 — TIMELINE FINANZIARIA (solo Intellera Consulting)
  // =========================================================================
  {
    pagina: '3 Timeline',
    sezione: 'Ambito del tab',
    elemento: 'Perimetro Intellera',
    formula: "match fornitore = lowercase(fornitore) contiene 'intellera'",
    spiegazione:
      'L’intero tab è ristretto al solo fornitore Intellera Consulting: serie e totali escludono gli altri partner RTI.',
    sorgenti: 'interventi.fornitore, bef_records.fornitore_reale',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Serie Revenue vs Fatturazione',
    elemento: 'Revenue mensile',
    formula: 'revenue[m] = Σ rev_mesi[m] delle IF con fornitore = Intellera',
    spiegazione:
      'Serie di revenue ricostruita mese per mese dai profili rev_mesi delle sole IF Intellera (la tabella timeline_mensile non ha il dettaglio per fornitore).',
    sorgenti: 'interventi.rev_mesi[] (Intellera)',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Serie Revenue vs Fatturazione',
    elemento: 'Fatturazione (consuntivato) mensile',
    formula: 'consuntivato[m] = Σ cons_mesi[m] delle IF con fornitore = Intellera',
    spiegazione: 'Serie di consuntivazione/fatturazione ricostruita dai profili cons_mesi delle IF Intellera.',
    sorgenti: 'interventi.cons_mesi[] (Intellera)',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Aggregazione temporale',
    elemento: 'Vista solare / fiscale',
    formula:
      'Solare: mesi Gen..Dic dell’anno Y. Fiscale: Set(Y)..Ago(Y+1) (l’anno fiscale Y attraversa due anni solari).',
    spiegazione:
      'Selettore calendario: l’anno fiscale inizia a settembre. In vista fiscale i mesi Set–Dic sono dell’anno Y, Gen–Ago dell’anno Y+1.',
    sorgenti: 'lib/fiscal.ts (FISCAL_ORDER)',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Aggregazione temporale',
    elemento: 'Trimestri',
    formula:
      'Solare: Q1 Gen–Mar, Q2 Apr–Giu, Q3 Lug–Set, Q4 Ott–Dic. Fiscale: Q1 Set–Nov, Q2 Dic–Feb, Q3 Mar–Mag, Q4 Giu–Ago. Valore Q = somma dei 3 mesi.',
    spiegazione: 'In vista trimestrale ogni barra è la somma dei tre mesi del trimestre nel calendario scelto.',
    sorgenti: 'lib/fiscal.ts (Q_SOLARE, Q_FISCALE)',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Serie Revenue vs Fatturazione',
    elemento: 'Cumulati (linee)',
    formula: 'cum[i] = Σ(k=0..i) valore[k]  (per revenue, per fatturazione e per fatturato BEF)',
    spiegazione:
      'Le linee sono le somme progressive delle barre lungo i periodi visualizzati. Sono tre serie distinte: “Cum. Revenue” (revenue di competenza), “Cum. Fatturazione” (consuntivato a piano, da cons_mesi) e — quando esistono righe BEF fatturate nel periodo — “Cum. Fatturato (BEF)”. Le ultime due NON coincidono: la seconda è il piano, la terza il consuntivo delle fatture emesse.',
    sorgenti: 'serie revenue / fatturazione / fatturato BEF',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Revenue totale',
    formula: 'totR = Σ revenue[periodo] (anno/vista selezionati)',
    spiegazione: 'Revenue di competenza totale del periodo e calendario selezionati.',
    sorgenti: 'interventi.rev_mesi[] (Intellera)',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Valore IF Attivate (fatturazione totale)',
    formula: 'totF = Σ consuntivato[periodo]',
    spiegazione: 'Totale consuntivato/fatturabile del periodo selezionato.',
    sorgenti: 'interventi.cons_mesi[] (Intellera)',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Revenue maturata ad oggi',
    formula: 'matR = Σ(periodi fino a quello corrente incluso) revenue[periodo]',
    spiegazione:
      'Revenue dei periodi già trascorsi nell’anno/vista, incluso il periodo corrente (il taglio "oggi" dipende da calendario e granularità).',
    sorgenti: 'serie revenue, data odierna',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Avanzamento revenue',
    formula: 'avanzamento% = matR / totR × 100',
    spiegazione: 'Quota della revenue del periodo già maturata ad oggi.',
    sorgenti: 'serie revenue',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Fatturato (BEF)',
    elemento: 'Fatturato BEF per mese',
    formula:
      'befMese[anno-mese] = Σ importo_ricezione delle righe BEF fatturate (con num_fattura E data_fattura, incassate o meno), raggruppate per mese di data_fattura, solo fornitore_reale = Intellera',
    spiegazione:
      'Terza serie di barre opzionale: il fatturato effettivo da BEF collocato nel mese della fattura. Le righe ancora da emettere e quelle in attesa di approvazione non compaiono in questa serie: non avendo data_fattura non hanno un mese a cui essere assegnate.',
    sorgenti: 'bef_records (Intellera): importo_ricezione, num_fattura, data_fattura',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Fatturabile ad oggi',
    formula:
      'fatturabile = Σ importo_ricezione delle righe BEF Intellera SENZA num_fattura (tutte le annualità caricate, non solo l’anno selezionato)',
    spiegazione:
      'Importo BEF la cui fattura deve ancora essere emessa. Indicatore di portafoglio: queste righe non portano una data su cui filtrarle per anno, quindi — a differenza del grafico — non è ristretto al periodo selezionato. Una riga con data fattura ma senza numero è un dato incompleto (non può essere una fattura emessa) e resta conteggiata qui.',
    sorgenti: 'bef_records (Intellera): importo_ricezione, num_fattura, data_fattura',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Fatturato in attesa',
    formula:
      'fatturatoInAttesa = Σ importo_ricezione delle righe BEF Intellera CON num_fattura ma SENZA data_fattura (tutte le annualità caricate)',
    spiegazione:
      'Fattura emessa ma non ancora approvata dal cliente. Caso raro: di norma numero e data fattura sono entrambi presenti o entrambi assenti; un valore diverso da zero segnala fatture ferme in approvazione.',
    sorgenti: 'bef_records (Intellera): importo_ricezione, num_fattura, data_fattura',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Fatturato emesso',
    formula:
      'fatturatoEmesso = Σ importo_ricezione delle righe BEF Intellera CON num_fattura E data_fattura ma SENZA data_pagamento (tutte le annualità caricate, non solo l’anno selezionato)',
    spiegazione:
      'Importo delle fatture emesse e approvate, non ancora incassate. La somma è su TUTTE le righe: una stessa fattura copre normalmente più righe BEF (una per BDO e per periodo di competenza) e ognuna contribuisce con il proprio importo. Indicatore di portafoglio, non ristretto al periodo del grafico.',
    sorgenti: 'bef_records (Intellera): importo_ricezione, num_fattura, data_fattura, data_pagamento',
  },
  {
    pagina: '3 Timeline',
    sezione: 'Indicatori',
    elemento: 'Fatturato incassato',
    formula:
      'fatturatoIncassato = Σ importo_ricezione delle righe BEF Intellera CON num_fattura, data_fattura E data_pagamento (tutte le annualità caricate, non solo l’anno selezionato)',
    spiegazione:
      'Importo delle fatture emesse e già incassate: è la valorizzazione di data_pagamento a segnare l’avvenuto incasso. Insieme a “Fatturabile ad oggi”, “Fatturato in attesa” e “Fatturato emesso” copre ogni riga BEF una sola volta: i quattro indicatori sommano al totale BEF Intellera.',
    sorgenti: 'bef_records (Intellera): importo_ricezione, num_fattura, data_fattura, data_pagamento',
  },

  // =========================================================================
  // 4 — DISTRIBUZIONE IF
  // =========================================================================
  {
    pagina: '4 Distribuzione',
    sezione: 'Base di calcolo',
    elemento: 'Totale importo vista',
    formula: 'tot = Σ importo (tutte le IF della vista)',
    spiegazione: 'Denominatore usato per le percentuali sul totale nelle tabelle di distribuzione.',
    sorgenti: 'interventi.importo',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4a — Per Ambito',
    elemento: 'N° IF per ambito',
    formula: "n[ambito] = conteggio IF con ambito = k (null → 'Non classificato')",
    spiegazione: 'Numero di IF per ciascun macro-ambito.',
    sorgenti: 'interventi.ambito',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4a — Per Ambito',
    elemento: 'Valore € per ambito',
    formula: 'v[ambito] = Σ importo delle IF con ambito = k',
    spiegazione: 'Somma degli importi delle IF per ciascun ambito, ordinata in modo decrescente.',
    sorgenti: 'interventi.importo, interventi.ambito',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4a — Per Ambito',
    elemento: '% sul totale',
    formula: 'pct[ambito] = v[ambito] / tot × 100',
    spiegazione: 'Peso percentuale dell’ambito sul valore totale della vista.',
    sorgenti: 'interventi.importo, interventi.ambito',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4b — Per Referente ARIA',
    elemento: 'Intellera € per referente',
    formula: 'Intellera[ref] = Σ importo delle IF con ref_aria = k e fornitore = Intellera',
    spiegazione: 'Quota Intellera del valore gestito da ciascun referente ARIA.',
    sorgenti: 'interventi.importo, interventi.ref_aria, interventi.fornitore',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4b — Per Referente ARIA',
    elemento: 'Deloitte € per referente',
    formula: 'Deloitte[ref] = Σ importo delle IF con ref_aria = k e fornitore = Deloitte',
    spiegazione: 'Quota Deloitte del valore gestito da ciascun referente ARIA.',
    sorgenti: 'interventi.importo, interventi.ref_aria, interventi.fornitore',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4b — Per Referente ARIA',
    elemento: 'Altro € per referente',
    formula: 'Altro[ref] = Σ importo delle IF con ref_aria = k e fornitore ∉ {Intellera, Deloitte}',
    spiegazione: 'Valore attribuito a fornitori diversi da Intellera e Deloitte per ciascun referente.',
    sorgenti: 'interventi.importo, interventi.ref_aria, interventi.fornitore',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4b — Per Referente ARIA',
    elemento: 'Totale € per referente',
    formula: 'tot[ref] = Intellera[ref] + Deloitte[ref] + Altro[ref]',
    spiegazione: 'Valore complessivo gestito dal referente (barra impilata).',
    sorgenti: 'interventi.importo, interventi.ref_aria',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4b — Per Referente ARIA',
    elemento: 'N° IF per referente',
    formula: 'n[ref] = conteggio IF con ref_aria = k',
    spiegazione: 'Numero di IF gestite da ciascun referente ARIA.',
    sorgenti: 'interventi.ref_aria',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4c — Per Seniority',
    elemento: 'GG/Uomo per figura',
    formula: 'gg[figura] = giorni uomo a portafoglio della figura',
    spiegazione: 'Giornate/uomo pianificate per ciascuna figura professionale (intero portafoglio).',
    sorgenti: 'tariffe/seniority: gg',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4c — Per Seniority',
    elemento: 'GG totali',
    formula: 'totg = Σ gg[figura]',
    spiegazione: 'Totale delle giornate/uomo pianificate su tutte le figure (centro del donut).',
    sorgenti: 'tariffe/seniority: gg',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4c — Per Seniority',
    elemento: 'Tariffa €/gg per figura',
    formula: 'tariffa[figura] (listino, € al giorno)',
    spiegazione: 'Tariffa giornaliera di listino della figura professionale.',
    sorgenti: 'tariffe/seniority: tariffa',
  },
  {
    pagina: '4 Distribuzione',
    sezione: '4c — Per Seniority',
    elemento: 'Valore giornate figura',
    formula: 'valore[figura] = gg[figura] × tariffa[figura]',
    spiegazione:
      'Valore economico stimato delle giornate di una figura (giorni uomo per tariffa giornaliera).',
    sorgenti: 'tariffe/seniority: gg, tariffa',
  },
];

// Serializza il catalogo in CSV (separatore ';', compatibile con Excel it-IT).
// Aggiunge un blocco introduttivo con le convenzioni trasversali e il BOM UTF-8
// perché Excel apra correttamente gli accenti.
export function buildFormulaCsv(rows: FormulaRow[] = FORMULA_CATALOG): string {
  const header = ['Pagina', 'Sezione', 'Elemento / Valore', 'Formula', 'Spiegazione', 'Sorgenti dati'];
  const intro: string[][] = [
    ['Dashboard ARIA SISS L2 — Formule dei valori calcolati'],
    [`Esportazione del ${new Date().toLocaleString('it-IT')}`],
    [
      'Nota: "vista corrente" = insieme delle IF/BO dopo i filtri della barra (fornitore, referente, ambito, stato, modalità…). I record soft-deleted sono sempre esclusi. rev_mesi/cons_mesi sono profili di 12 valori in ordine solare (Gen..Dic).',
    ],
    [],
  ];
  const q = (c: string) => `"${String(c).replace(/"/g, '""')}"`;
  const lines: string[] = [];
  for (const r of intro) lines.push(r.map(q).join(';'));
  lines.push(header.map(q).join(';'));
  for (const r of rows) {
    lines.push([r.pagina, r.sezione, r.elemento, r.formula, r.spiegazione, r.sorgenti].map(q).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}
