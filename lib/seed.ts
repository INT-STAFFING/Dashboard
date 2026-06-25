import seedJson from './data/seed.json';
import type {
  Intervento,
  Seniority,
  ModalitaAgg,
  RtiConfig,
  Timeline,
  Meta,
} from './types';

type RawIntervento = {
  numero_if: string;
  titolo: string;
  bdo: string | null;
  has_bo: boolean;
  stato: string;
  importo: number;
  revenue_2026: number;
  rev_mesi: number[];
  cons_mesi?: number[];
  data_assegnazione: string | null;
  data_inizio: string | null;
  data_fine: string | null;
  ref_aria: string | null;
  ref_fornitore: string | null;
  ambito: string | null;
  fornitore: string;
  subappalto: boolean;
  subappaltatore: string[];
  costo_subappalto: number;
  modalita_if: string | null;
  attivazione: string | null;
  pdc: string;
  v_apertura: string;
  v_sal: string;
  bef: string;
  azione: string | null;
};

const raw = seedJson as unknown as {
  meta: Meta;
  fornitori_filter: string[];
  rti: RtiConfig;
  quota_val: Record<string, number>;
  timeline: Timeline;
  interventi: RawIntervento[];
  seniority: Seniority[];
  modalita: ModalitaAgg[];
};

function norm(v: string): Intervento['pdc'] {
  if (v === 'ok' || v === 'ko' || v === 'prog' || v === 'nd') return v;
  return 'nd';
}

export const SEED_INTERVENTI: Intervento[] = raw.interventi.map((i) => ({
  numero_if: i.numero_if,
  bdo: i.bdo,
  titolo: i.titolo,
  ambito: i.ambito,
  fornitore: i.fornitore,
  ref_aria: i.ref_aria,
  ref_fornitore: i.ref_fornitore,
  importo: i.importo,
  revenue_2026: i.revenue_2026,
  rev_mesi: i.rev_mesi && i.rev_mesi.length === 12 ? i.rev_mesi : Array(12).fill(0),
  cons_mesi: i.cons_mesi && i.cons_mesi.length === 12 ? i.cons_mesi : Array(12).fill(0),
  modalita_if: i.modalita_if,
  attivazione: i.attivazione,
  stato: i.stato,
  has_bo: i.has_bo,
  pdc: norm(i.pdc),
  v_apertura: norm(i.v_apertura),
  v_sal: norm(i.v_sal),
  bef: norm(i.bef),
  subappalto: i.subappalto,
  subappaltatore: i.subappaltatore || [],
  costo_subappalto: i.costo_subappalto || 0,
  data_assegnazione: i.data_assegnazione,
  data_inizio: i.data_inizio,
  data_fine: i.data_fine,
  azione: i.azione,
  note_operative: null,
  edited_manually: false,
  last_edited_at: null,
  last_edited_by: null,
}));

export const SEED_META: Meta = raw.meta;
export const SEED_FORNITORI: string[] = raw.fornitori_filter;
export const SEED_RTI: RtiConfig = raw.rti;
export const SEED_QUOTA_VAL: Record<string, number> = raw.quota_val;
export const SEED_TIMELINE: Timeline = raw.timeline;
export const SEED_SENIORITY: Seniority[] = raw.seniority;
export const SEED_MODALITA: ModalitaAgg[] = raw.modalita;
