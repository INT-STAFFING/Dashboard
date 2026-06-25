import { SEED_SENIORITY, SEED_MODALITA, SEED_TIMELINE } from './seed';
import { getSetting, setSetting } from './settings';
import type { Seniority, ModalitaAgg, Timeline } from './types';

// Portfolio-level aggregates (seniority/tariffe mix, modalità split, revenue
// timeline). Persisted via the generic settings store (DB-backed with an
// in-memory fallback) so admin edits and Aggregatore uploads survive.

export async function getSeniority(): Promise<Seniority[]> {
  return getSetting<Seniority[]>('seniority', SEED_SENIORITY);
}
export async function setSeniority(s: Seniority[]): Promise<Seniority[]> {
  if (!s.length) return getSeniority();
  return setSetting<Seniority[]>('seniority', s);
}

export async function getModalita(): Promise<ModalitaAgg[]> {
  return getSetting<ModalitaAgg[]>('modalita', SEED_MODALITA);
}

export async function getTimeline(): Promise<Timeline> {
  return getSetting<Timeline>('timeline', SEED_TIMELINE);
}
export async function setTimeline(t: Timeline): Promise<Timeline> {
  return setSetting<Timeline>('timeline', t);
}
