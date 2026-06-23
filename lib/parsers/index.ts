import type { Intervento, BefRecord, VerbaleChiusura, Seniority } from '../types';
import { parseIF } from './parseIF';
import { parseBEF } from './parseBEF';
import { parseChiusura } from './parseChiusura';
import { parseAggregatore } from './parseAggregatore';

export type FileKind = 'if' | 'bef' | 'chiusura' | 'aggregatore' | 'unknown';

export function detectKind(filename: string): FileKind {
  const n = filename.toLowerCase();
  if (n.includes('aggregatore')) return 'aggregatore';
  if (n.includes('chiusura')) return 'chiusura';
  if (n.includes('bef')) return 'bef';
  if (n.includes('if_aria') || n.includes('monitoraggio') || n.includes('dettaglio'))
    return 'if';
  return 'unknown';
}

export type ParseOutput = {
  kind: FileKind;
  interventi?: Intervento[];
  bef?: BefRecord[];
  chiusura?: VerbaleChiusura[];
  seniority?: Seniority[];
};

export function parseFile(filename: string, buf: ArrayBuffer | Buffer): ParseOutput {
  const kind = detectKind(filename);
  switch (kind) {
    case 'if':
      return { kind, interventi: parseIF(buf) };
    case 'bef':
      return { kind, bef: parseBEF(buf) };
    case 'chiusura':
      return { kind, chiusura: parseChiusura(buf) };
    case 'aggregatore': {
      const { seniority, interventi } = parseAggregatore(buf);
      return { kind, seniority, interventi };
    }
    default:
      return { kind: 'unknown' };
  }
}

export { parseIF, parseBEF, parseChiusura, parseAggregatore };
