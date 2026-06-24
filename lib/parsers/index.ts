import type { Intervento, BefRecord, VerbaleChiusura, Seniority } from '../types';
import { parseIF } from './parseIF';
import { parseBEF } from './parseBEF';
import { parseChiusura } from './parseChiusura';
import { parseAggregatore } from './parseAggregatore';
import { parseDashboard } from './parseDashboard';
import { readWorkbook } from './util';

export type FileKind = 'if' | 'bef' | 'chiusura' | 'aggregatore' | 'dashboard' | 'unknown';

export function detectKind(filename: string): FileKind {
  const n = filename.toLowerCase();
  if (n.includes('dashboard')) return 'dashboard';
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
    case 'dashboard': {
      const { seniority, interventi } = parseDashboard(buf);
      return { kind, seniority, interventi };
    }
    default: {
      // Fall back to content sniffing: the master Dashboard workbook is
      // identified by its data sheets regardless of how the file is named.
      try {
        const wb = readWorkbook(buf);
        const has = (name: string) => wb.SheetNames.some((s) => s === name);
        if (has('TIMELINE_REVENUE') && has('DATI')) {
          const { seniority, interventi } = parseDashboard(wb);
          return { kind: 'dashboard', seniority, interventi };
        }
      } catch {
        // not a spreadsheet we can read -> report as unknown below
      }
      return { kind: 'unknown' };
    }
  }
}

export { parseIF, parseBEF, parseChiusura, parseAggregatore, parseDashboard };
