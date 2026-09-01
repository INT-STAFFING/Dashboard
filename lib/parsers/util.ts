import * as XLSX from 'xlsx';
import type { DocStatus } from '../types';

export type Workbook = XLSX.WorkBook;

export function readWorkbook(buf: ArrayBuffer | Buffer | Uint8Array): Workbook {
  // Normalize to a byte array and read with type 'array' so the same code path
  // works both server-side (Buffer) and in the browser (ArrayBuffer/Uint8Array).
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer);
  return XLSX.read(data, { type: 'array', cellDates: true });
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

// Read a sheet as a raw matrix of rows (no header keying). Useful when the
// header cells are dates/duplicated and must be matched positionally.
export function sheetMatrix(wb: Workbook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  }) as unknown[][];
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

// Quale fra '.' e ',' è il separatore DECIMALE di una stringa numerica.
//  - se compaiono entrambi, il decimale è l'ultimo dei due:
//    "1.234,56" (IT) -> ',' ; "1,234.56" (EN) -> '.'
//  - con un solo tipo di separatore, un gruppo finale di esattamente 3 cifre
//    è un separatore delle migliaia ("1.234" -> 1234), qualsiasi altra
//    lunghezza è la parte decimale ("216425,15", "216425.15" -> 216425.15);
//  - separatori ripetuti sono sempre migliaia ("1.234.567").
// Restituisce null quando non c'è parte decimale.
function decimalSep(s: string): '.' | ',' | null {
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot < 0 && lastComma < 0) return null;
  if (lastDot >= 0 && lastComma >= 0) return lastDot > lastComma ? '.' : ',';
  const sep = lastDot >= 0 ? '.' : ',';
  if (s.split(sep).length > 2) return null;
  return s.length - Math.max(lastDot, lastComma) - 1 === 3 ? null : sep;
}

// Importi e quantità -> number. Accetta il numero già tipizzato da xlsx e le
// stringhe nei formati che gli export producono ("€ 1.234,56", "1,234.56",
// "1234.56"). Il separatore decimale è dedotto (vedi decimalSep) invece di
// assumere sempre la convenzione italiana: trattare il punto come separatore
// delle migliaia moltiplicava per 100 ogni importo scritto "216425.15".
export function toNumber(v: unknown): number {
  if (v == null || v === '' || v === '—') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return 0;
  const sep = decimalSep(s);
  const cut = sep ? s.lastIndexOf(sep) : s.length;
  const neg = s.startsWith('-');
  const intPart = s.slice(0, cut).replace(/\D/g, '');
  const decPart = s.slice(cut + 1).replace(/\D/g, '');
  const n = Number(`${neg ? '-' : ''}${intPart || '0'}${decPart ? `.${decPart}` : ''}`);
  return Number.isFinite(n) ? n : 0;
}

// Excel's day-zero. Serial 1 is 1900-01-01 and Excel keeps the phantom
// 1900-02-29, so every serial from 61 on lines up with a 1899-12-30 epoch.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

const p2 = (n: number) => String(n).padStart(2, '0');

// ISO yyyy-mm-dd from a Date's LOCAL calendar parts.
// `readWorkbook` uses `cellDates`, and xlsx builds those Date objects from the
// serial's calendar parts in local time. Reading them back as UTC
// (`toISOString`) therefore shifts every date one day earlier on any timezone
// east of Greenwich (Europe/Rome included) — enough to move an invoice dated
// the 1st of a month into the previous month's bucket, which is what the
// monthly BEF series aggregates on.
const localISO = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// Excel serial -> ISO yyyy-mm-dd. Guarded to the range Excel can represent
// (1 = 1899-12-31 … 2958465 = 9999-12-31) so a plain number that is *not* a
// date (an amount, an identifier) yields null instead of a bogus year.
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const d = new Date(EXCEL_EPOCH_UTC + Math.round(serial) * 86400000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

// Accepts Date objects, Excel serials, "gg/mm/aaaa" (also with '-' or '.'
// separators) or ISO strings -> ISO yyyy-mm-dd (or null)
export function toISODate(v: unknown): string | null {
  if (v == null || v === '' || v === '—') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : localISO(v);
  // A numeric date cell whose column carries no date number-format arrives as
  // the raw Excel serial. `new Date("45678")` reads that as a *year*
  // ("+045677-12"), so convert it explicitly instead.
  if (typeof v === 'number') return fromExcelSerial(v);
  const s = String(v).trim();
  const it = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (it) {
    const [, d, m, y] = it;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return fromExcelSerial(Number(s.replace(',', '.')));
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : localISO(parsed);
}

export function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === '—' || s === 'nan' ? null : s;
}

// Undo the `cellDates` coercion of a cell that only *looks* like a date.
// When a numeric cell carries a date number-format, xlsx hands back a Date
// instead of the number — an IF like 20260323 becomes "Fri Nov 16 57370".
// xlsx builds that Date from the serial's calendar parts in local time, so
// reading the same parts back recovers the number Excel actually stores.
// Returns null when the round trip isn't a whole positive number of days —
// including a serial so large it overflows the Date range (xlsx hands back an
// Invalid Date and the number is gone), where dropping the value beats keeping
// a bogus "Invalid Date" identifier.
export function excelSerialFromDate(d: Date): number | null {
  if (isNaN(d.getTime())) return null;
  const utc = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
  const serial = (utc - EXCEL_EPOCH_UTC) / 86400000;
  return Number.isInteger(serial) && serial > 0 ? serial : null;
}

// Identifier columns (N° IF, Numero BDO, Numero RDI, …) sometimes arrive as a
// float (e.g. 2017331334.0) because Excel/xlsx reads a numeric-looking cell as
// a number, or as a Date when the source sheet left a date number-format on the
// column. Always render them as an integer string, never with a decimal tail
// and never as a timestamp.
export function strId(v: unknown): string | null {
  if (v == null) return null;
  // An identifier never legitimately holds a date: a Date here is always a
  // mis-formatted number, so put it back the way Excel stored it.
  if (v instanceof Date) {
    const serial = excelSerialFromDate(v);
    return serial == null ? null : String(serial);
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(Math.trunc(v)) : null;
  }
  const s = String(v).trim();
  if (s === '' || s === '—' || s === 'nan') return null;
  const wholeFloat = s.match(/^-?\d+\.0+$/);
  return wholeFloat ? String(Math.trunc(Number(s))) : s;
}

// Look up a row value trying several header spellings in order (some
// extractions carry small typos/variations in a column header).
export function pick(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in r) return r[k];
  }
  return undefined;
}

// Header normalization for `looseGetter`: case, accents, punctuation and
// repeated spaces are dropped, so "Numero Fattura", "numero fattura" and
// "N° Fattura " all collapse onto the same lookup key.
const normHeader = (h: string) =>
  h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// A getter over one row that matches headers loosely (see `normHeader`) and
// accepts several spellings per column. Exact-key access silently yields
// `undefined` when an export renames a column by so much as a capital letter —
// for a column the aggregates key on (e.g. "Numero Fattura", which decides
// whether a BEF row counts as fatturata) that turns into a wrong KPI rather
// than a visible error, so those parsers read through this instead.
export function looseGetter(
  r: Record<string, unknown>,
): (...keys: string[]) => unknown {
  const map = new Map<string, unknown>();
  for (const k of Object.keys(r)) {
    const nk = normHeader(k);
    if (nk && !map.has(nk)) map.set(nk, r[k]);
  }
  return (...keys: string[]) => {
    for (const k of keys) {
      const v = map.get(normHeader(k));
      if (v !== undefined) return v;
    }
    return undefined;
  };
}

// Header row of a sheet (trimmed, blanks dropped) — used to sanity-check an
// export's columns against what a parser expects.
export function sheetHeaders(wb: Workbook, sheetName: string, headerRowIndex = 0): string[] {
  const matrix = sheetMatrix(wb, sheetName);
  if (matrix.length <= headerRowIndex) return [];
  return (matrix[headerRowIndex] as unknown[])
    .map((h) => String(h ?? '').trim())
    .filter(Boolean);
}

// Warn (non-blocking) when a sheet's headers don't cover every column a
// parser expects — extractions occasionally carry small refusi/variations.
export function warnIfHeaderMismatch(actual: string[], expected: string[], label: string): void {
  const missing = expected.filter((h) => !actual.includes(h));
  if (missing.length) {
    console.warn(`[${label}] intestazioni attese non trovate nel foglio: ${missing.join(', ')}`);
  }
}

const RTI_INTELLERA = 'rti 7-26 intellera';

// Solo le righe del RTI Intellera vanno importate: le altre righe del report
// (altri fornitori del raggruppamento) devono essere scartate. Il fornitore
// può comparire in una colonna "Fornitore" o "Fornitore RTI" a seconda
// dell'export — basta che una delle due combaci.
//
// La colonna è cercata con `looseGetter`: essendo questo l'unico filtro di
// import, una variante di maiuscole o uno spazio di troppo nell'intestazione
// scartava silenziosamente OGNI riga del report.
export function isRtiIntellera(r: Record<string, unknown>): boolean {
  const g = looseGetter(r);
  const match = (v: unknown) => {
    const s = str(v);
    return !!s && s.toLowerCase().includes(RTI_INTELLERA);
  };
  return match(g('Fornitore RTI')) || match(g('Fornitore'));
}
