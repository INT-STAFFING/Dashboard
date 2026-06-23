import * as XLSX from 'xlsx';
import type { DocStatus } from '../types';

export type Workbook = XLSX.WorkBook;

export function readWorkbook(buf: ArrayBuffer | Buffer): Workbook {
  return XLSX.read(buf, { type: 'buffer', cellDates: true });
}

// Read a sheet as an array of row-objects keyed by the header row.
export function sheetRows(
  wb: Workbook,
  sheetName: string,
  headerRowIndex = 0,
): Record<string, unknown>[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  }) as unknown[][];
  if (matrix.length <= headerRowIndex) return [];
  const header = (matrix[headerRowIndex] as unknown[]).map((h) =>
    String(h ?? '').trim(),
  );
  const out: Record<string, unknown>[] = [];
  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] as unknown[];
    if (!row || row.every((c) => c == null || c === '')) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, c) => {
      if (h) obj[h] = row[c] ?? null;
    });
    out.push(obj);
  }
  return out;
}

export function findSheet(wb: Workbook, ...candidates: string[]): string | null {
  for (const c of candidates) {
    const exact = wb.SheetNames.find((s) => s === c);
    if (exact) return exact;
  }
  for (const c of candidates) {
    const partial = wb.SheetNames.find((s) =>
      s.toLowerCase().includes(c.toLowerCase()),
    );
    if (partial) return partial;
  }
  return null;
}

// Emoji / text status -> normalized DocStatus
export function parseDocStatus(raw: unknown): DocStatus {
  const s = String(raw ?? '');
  if (s.includes('✅')) return 'ok';
  if (s.includes('❌')) return 'ko';
  if (s.includes('🔄')) return 'prog';
  if (/\bok\b/i.test(s)) return 'ok';
  if (/mancante/i.test(s)) return 'ko';
  if (/in corso/i.test(s)) return 'prog';
  return 'nd';
}

export function toNumber(v: unknown): number {
  if (v == null || v === '' || v === '—') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Accepts Date objects, "gg/mm/aaaa" or ISO strings -> ISO yyyy-mm-dd (or null)
export function toISODate(v: unknown): string | null {
  if (v == null || v === '' || v === '—') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const it = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (it) {
    const [, d, m, y] = it;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === '—' || s === 'nan' ? null : s;
}
