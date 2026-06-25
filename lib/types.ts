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
