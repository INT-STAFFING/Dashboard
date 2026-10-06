import type { Intervento } from '@/lib/types';

// A complete Intervento with neutral defaults; override only what a test cares about.
export function makeIf(over: Partial<Intervento> = {}): Intervento {
  return {
    numero_if: '20260001',
    bdo: null,
    titolo: 'Intervento di prova',
    ambito: 'Sviluppo',
    fornitore: 'Intellera',
    ref_aria: null,
    ref_fornitore: null,
    importo: 0,
    revenue_anno: 0,
    rev_mesi: Array(12).fill(0),
    cons_mesi: Array(12).fill(0),
    modalita_if: null,
    attivazione: 'NO',
    stato: 'non elaborato',
    has_bo: false,
    pdc: 'nd',
    v_apertura: 'nd',
    v_sal: 'nd',
    bef: 'nd',
    subappalto: false,
    subappaltatore: [],
    costo_subappalto: 0,
    data_assegnazione: null,
    data_inizio: null,
    data_fine: null,
    azione: null,
    note_operative: null,
    edited_manually: false,
    last_edited_at: null,
    last_edited_by: null,
    ...over,
  };
}
