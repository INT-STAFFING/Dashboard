import type {
  Intervento,
  BefRecord,
  VerbaleChiusura,
  Seniority,
  ReportBdoRecord,
  ReportRdiRecord,
  VerbaleAperturaRecord,
  VerbaleSalRecord,
} from '../types';
import { parseIF } from './parseIF';
import { parseBEF } from './parseBEF';
import { parseChiusura } from './parseChiusura';
import { parseAggregatore } from './parseAggregatore';
import { parseDashboard } from './parseDashboard';
import { parseReportBdo, findReportBdoSheet } from './parseReportBdo';
import { parseReportRdi, findReportRdiSheet } from './parseReportRdi';
import { parseVerbaliApertura, findVerbaliAperturaSheet } from './parseVerbaliApertura';
import { parseVerbaliSal, findVerbaliSalSheet } from './parseVerbaliSal';
import { readWorkbook } from './util';

export type FileKind =
  | 'if'
  | 'bef'
  | 'chiusura'
  | 'aggregatore'
  | 'dashboard'
  | 'report_bdo'
  | 'report_rdi'
  | 'verbali_apertura'
  | 'verbali_sal'
  | 'unknown';

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
  reportBdo?: ReportBdoRecord[];
  reportRdi?: ReportRdiRecord[];
  verbaliApertura?: VerbaleAperturaRecord[];
  verbaliSal?: VerbaleSalRecord[];
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
      // Fall back to content sniffing: some exports (master Dashboard
      // workbook, "REPORT Bdo", "REPORT Rdi", "REPORT Apertura", "REPORT Sal")
      // have filenames that don't follow a fixed pattern (e.g. system-generated
      // timestamps/codes), so they're identified by their sheets instead.
      try {
        const wb = readWorkbook(buf);
        const has = (name: string) => wb.SheetNames.some((s) => s === name);
        if (has('TIMELINE_REVENUE') && has('DATI')) {
          const { seniority, interventi } = parseDashboard(wb);
          return { kind: 'dashboard', seniority, interventi };
        }
        if (findReportBdoSheet(wb)) {
          return { kind: 'report_bdo', reportBdo: parseReportBdo(wb) };
        }
        if (findReportRdiSheet(wb)) {
          return { kind: 'report_rdi', reportRdi: parseReportRdi(wb) };
        }
        if (findVerbaliAperturaSheet(wb)) {
          return { kind: 'verbali_apertura', verbaliApertura: parseVerbaliApertura(wb) };
        }
        if (findVerbaliSalSheet(wb)) {
          return { kind: 'verbali_sal', verbaliSal: parseVerbaliSal(wb) };
        }
      } catch {
        // not a spreadsheet we can read -> report as unknown below
      }
      return { kind: 'unknown' };
    }
  }
}

export {
  parseIF,
  parseBEF,
  parseChiusura,
  parseAggregatore,
  parseDashboard,
  parseReportBdo,
  parseReportRdi,
  parseVerbaliApertura,
  parseVerbaliSal,
};
