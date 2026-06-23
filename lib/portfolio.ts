import { SEED_SENIORITY, SEED_MODALITA, SEED_TIMELINE } from './seed';
import type { Seniority, ModalitaAgg, Timeline } from './types';

// Portfolio-level aggregates (seniority mix, modalità split, revenue timeline).
// These are not per-intervento and live in a global so an Aggregatore upload
// can refresh the seniority distribution without a database.
const g = globalThis as unknown as {
  __ARIA_SEN__?: Seniority[];
  __ARIA_MOD__?: ModalitaAgg[];
  __ARIA_TL__?: Timeline;
};

export function getSeniority(): Seniority[] {
  if (!g.__ARIA_SEN__) g.__ARIA_SEN__ = SEED_SENIORITY;
  return g.__ARIA_SEN__;
}
export function setSeniority(s: Seniority[]) {
  if (s.length) g.__ARIA_SEN__ = s;
}

export function getModalita(): ModalitaAgg[] {
  if (!g.__ARIA_MOD__) g.__ARIA_MOD__ = SEED_MODALITA;
  return g.__ARIA_MOD__;
}

export function getTimeline(): Timeline {
  if (!g.__ARIA_TL__) g.__ARIA_TL__ = SEED_TIMELINE;
  return g.__ARIA_TL__;
}
