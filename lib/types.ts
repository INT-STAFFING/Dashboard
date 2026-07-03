// Canonical domain types — field names mirror the original static dashboard's
// embedded DATA object so the rendering logic ports across directly.

export type DocStatus = 'ok' | 'ko' | 'prog' | 'nd'; // OK | Mancante | In corso | N/D

// --- Authentication / users -------------------------------------------------
export type Role = 'ADMIN' | 'USER' | 'USERPLUS';
export type UserStatus = 'pending' | 'approved' | 'rejected';

// User shape exposed to the client (never includes password_hash).
export type SafeUser = {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  created_at: string | null;
  approved_at: string | null;
};

export type Intervento = {
  numero_if: string;
  bdo: string | null;
  titolo: string;
  ambito: string | null;
  fornitore: string; // 'Intellera' | 'Deloitte' | ...
  ref_aria: string | null;
  ref_fornitore: string | null;
  importo: number;
  revenue_2026: number;
  rev_mesi: number[]; // length 12 (revenue per month, Gen..Dic)
  cons_mesi: number[]; // length 12 (consuntivazione/actuals per month, Gen..Dic)
  modalita_if: string | null;
  attivazione: string | null; // 'SI' | 'NO'
  stato: string; // 'approvato' | 'non elaborato'
  has_bo: boolean;
  pdc: DocStatus;
  v_apertura: DocStatus;
  v_sal: DocStatus;
  bef: DocStatus;
  subappalto: boolean;
  subappaltatore: string[];
  costo_subappalto: number;
  data_assegnazione: string | null;
  data_inizio: string | null;
  data_fine: string | null;
  azione: string | null;
  note_operative: string | null;
  edited_manually: boolean;
  last_edited_at: string | null;
  last_edited_by: string | null;
};

export type Seniority = {
  figura: string;
  code: string;
  gg: number;
  tariffa: number | null;
};

export type ModalitaAgg = {
  mod: string; // A_corpo | A_canone | A_consumo
  n: number;
  costo: number;
};

export type RtiPartner = {
  name: string;
  pct: number;
  quota: number;
  impegnato: number;
};

export type RtiConfig = {
  ceiling: number;
  partners: RtiPartner[];
  tot_impegnato: number;
  erosione_2026: number;
};

export type Timeline = {
  mesi: string[];
  revenue_2026: number[];
  consuntivazione_2026: number[];
  anno: number;
};

// --- Multi-year revenue (F-2) ----------------------------------------------
// Monthly fact anchored to the CALENDAR year (anno) and calendar month
// (mese 1..12). This single shape supports both the solar year (Gen–Dic) and
// the fiscal year (Set–Ago, which spans two calendar years) at monthly,
// quarterly and annual grain — see lib/fiscal.ts.
export type TimelineMonth = {
  anno: number;
  mese: number; // 1..12 (calendar)
  revenue: number;
  consuntivato: number;
};

export type MultiYearTimeline = {
  months: TimelineMonth[];
  years: number[]; // calendar years present, ascending
};

// Monthly total of `bef_records.importo_ricezione`, grouped by the calendar
// month of `data_fattura` (rows without a `data_fattura` are excluded).
export type BefMonthly = {
  anno: number;
  mese: number; // 1..12 (calendar)
  totale: number;
};

// Portfolio-level totals of `bef_records.importo_ricezione` (no period filter).
export type BefAggregates = {
  fatturabile: number; // righe senza numero fattura e senza data fattura
  fatturatoEmesso: number; // righe con numero fattura e data fattura
};

export type Meta = {
  cig: string;
  contratto: string;
  odag: string;
  generato: string;
  contract_date: string;
  valid_to: string;
  months: number;
};

export type BefRecord = {
  num_bdo: string | null;
  descrizione: string | null;
  periodo_competenza: string | null;
  fornitore_reale: string | null;
  importo_ricezione: number | null;
  num_fattura: string | null;
  data_fattura: string | null;
  data_pagamento: string | null;
};

export type VerbaleChiusura = {
  num_bdo: string | null;
  descrizione: string | null;
  stato_verbale: string | null;
  fornitore: string | null;
  roi: string | null;
  data_firma_roi: string | null;
};

// Row from the "REPORT Bdo" export (stato workflow approvativo per BDO).
// num_bdo ("Numero BDO") is the business key.
export type ReportBdoRecord = {
  num_bdo: string;
  descrizione_bdo: string | null;
  nome_file_pif_if: string | null;
  descrizione_pif_if: string | null;
  codifica_documento: string | null;
  stato_documento: string | null;
  divisione: string | null;
  centro_costo: string | null;
  ultima_pif_approvata: string | null;
  data_caricamento: string | null;
  utente_caricamento: string | null;
  fornitore: string | null;
  roi: string | null;
  data_invio_roi: string | null;
  data_approvazione_roi: string | null;
  data_rifiuto_roi: string | null;
  pmo: string | null;
  data_invio_pmo: string | null;
  data_approvazione_pmo: string | null;
  data_rifiuto_pmo: string | null;
  ctrm: string | null;
  data_invio_ctrm: string | null;
  data_approvazione_ctrm: string | null;
  data_rifiuto_ctrm: string | null;
  versione_corrente: string | null;
  data_versione_corrente: string | null;
  data_decorrenza: string | null;
};

// Row from the "REPORT Rdi" export (Richieste di Intervento). numero_rdi
// ("Numero RDI") is the business key.
export type ReportRdiRecord = {
  numero_rdi: string;
  descrizione_rdi: string | null;
  nome_file_pif_if: string | null;
  codifica_documento: string | null;
  stato_documento: string | null;
  divisione: string | null;
  centro_costo: string | null;
  ultima_pif_approvata: string | null;
  descrizione_pif_if: string | null;
  data_caricamento: string | null;
  utente_caricamento: string | null;
  fornitore: string | null;
  roi: string | null;
  data_invio_roi: string | null;
  data_rifiuto_roi: string | null;
  data_approvazione_roi: string | null;
};

// Row from the "REPORT Apertura" export (verbali di apertura).
export type VerbaleAperturaRecord = {
  num_bdo: string | null;
  descrizione: string | null;
  nome_file: string | null;
  codifica_documento: string | null;
  stato_verbale: string | null;
  periodo_competenza: string | null;
  divisione: string | null;
  centro_costo: string | null;
  fornitore: string | null;
  utente_caricamento_fornitore: string | null;
  data_firma_fornitore: string | null;
  roi: string | null;
  data_inserimento_verbale_non_sottomesso: string | null;
  data_sottomissione_verbale_fornitore: string | null;
  data_firma_roi: string | null;
  data_rifiuto_roi: string | null;
  data_invio_roi: string | null;
};

// Row from the "REPORT Sal" export (verbali SAL). Multiple rows per num_bdo
// are expected (periodic SAL).
export type VerbaleSalRecord = {
  num_bdo: string | null;
  descrizione: string | null;
  nome_file: string | null;
  codifica_documento: string | null;
  stato_verbale: string | null;
  periodo_competenza: string | null;
  conforme: string | null;
  motivo_conformita: string | null;
  criticita: string | null;
  motivazione_criticita: string | null;
  livelli_servizio_rispettati: string | null;
  divisione: string | null;
  centro_costo: string | null;
  fornitore: string | null;
  utente_caricamento_fornitore: string | null;
  data_firma_fornitore: string | null;
  roi: string | null;
  data_inserimento_verbale_non_sottomesso: string | null;
  data_sottomissione_verbale_fornitore: string | null;
  data_firma_roi: string | null;
  data_rifiuto_roi: string | null;
  data_invio_roi: string | null;
};

// Aggregated payload returned by GET /api/data
export type DashboardData = {
  meta: Meta;
  fornitori_filter: string[];
  interventi: Intervento[];
  seniority: Seniority[];
  modalita: ModalitaAgg[];
  rti: RtiConfig;
  quota_val: Record<string, number>;
  timeline: Timeline;
  timeline_my: MultiYearTimeline;
  bef_monthly: BefMonthly[];
  bef_aggregates: BefAggregates;
  kpi: Kpi;
  revenue_mensile: { mese: string; intellera: number; deloitte: number }[];
  distribuzione_ambito: { ambito: string; count: number; valore: number }[];
};

export type Kpi = {
  count: number;
  totale: number;
  medio: number;
  bo_emessi: number;
  bo_attesa: number;
  intellera: number;
  deloitte: number;
};

// Subset of fields editable via the UI (PUT / POST)
export type InterventoInput = Partial<
  Omit<Intervento, 'rev_mesi' | 'cons_mesi' | 'subappaltatore'> & {
    rev_mesi: number[];
    cons_mesi: number[];
    subappaltatore: string[];
  }
>;

// Per-IF/BO resource allocation row (figure professionali, gruppi, giorni uomo).
export type IfRisorsa = {
  id?: number;
  numero_if: string;
  figura: string | null;
  sigla: string | null;
  gruppo: string | null;
  gg: number | null;
  tariffa_giornaliera: number | null;
};

// Per-IF/BO BEF row.
export type BefRow = {
  id?: number;
  numero_if: string;
  num_bdo: string | null;
  descrizione: string | null;
  periodo_competenza: string | null;
  fornitore_reale: string | null;
  importo_ricezione: number | null;
  num_fattura: string | null;
  data_fattura: string | null;
  data_pagamento: string | null;
};
