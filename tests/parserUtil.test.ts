// Run the date helpers in the timezone the app is used in: the "one day earlier"
// bug fixed in toISODate only shows up east of Greenwich.
process.env.TZ = 'Europe/Rome';

import { describe, expect, it } from 'vitest';
import {
  excelSerialFromDate,
  findSheet,
  isRtiIntellera,
  looseGetter,
  normalizeFornitore,
  parseDocStatus,
  pick,
  str,
  strId,
  toISODate,
  toNumber,
  type Workbook,
} from '@/lib/parsers/util';

describe('test environment', () => {
  it('runs in Europe/Rome (the timezone that exposes date off-by-one bugs)', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
  });
});

describe('toNumber', () => {
  it.each([
    [1234.5, 1234.5],
    [0, 0],
    [-7, -7],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['216425,15', 216425.15],
    ['216425.15', 216425.15], // not read as thousands: this used to be multiplied by 100
    ['1.234', 1234],
    ['1,234', 1234],
    ['1.234.567', 1234567],
    ['€ 1.234,56', 1234.56],
    ['12,5', 12.5],
    ['1.5', 1.5],
    ['0,5', 0.5],
    ['-12,5', -12.5],
    ['  42  ', 42],
  ])('%j -> %s', (input, expected) => {
    expect(toNumber(input)).toBeCloseTo(expected as number, 6);
  });

  it.each([[null], [undefined], [''], ['—'], ['-'], ['abc'], [NaN], [Infinity]])('%j -> 0', (input) => {
    expect(toNumber(input)).toBe(0);
  });
});

describe('toISODate', () => {
  it('reads Date objects by their LOCAL calendar parts (no day shift in Rome)', () => {
    expect(toISODate(new Date(2026, 0, 1))).toBe('2026-01-01'); // would be 2025-12-31 through toISOString()
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('parses Italian and ISO strings', () => {
    expect(toISODate('05/01/2026')).toBe('2026-01-05');
    expect(toISODate('5-1-26')).toBe('2026-01-05');
    expect(toISODate('05.01.2026')).toBe('2026-01-05');
    expect(toISODate('2026-01-05')).toBe('2026-01-05');
    expect(toISODate('2026-01-05T23:30:00Z')).toBe('2026-01-05');
  });

  it('converts Excel serials, as numbers or numeric strings', () => {
    expect(toISODate(45658)).toBe('2025-01-01');
    expect(toISODate('45658')).toBe('2025-01-01');
    expect(toISODate(61)).toBe('1900-03-01'); // Excel's phantom 1900-02-29 is accounted for
  });

  it('returns null for blanks, out-of-range numbers and garbage', () => {
    for (const v of [null, undefined, '', '—', 0, -5, 3_000_000, 'garbage', new Date('x')]) {
      expect(toISODate(v)).toBeNull();
    }
  });
});

describe('str / strId', () => {
  it('str trims and nulls out blanks, dashes and "nan"', () => {
    expect(str('  ciao ')).toBe('ciao');
    for (const v of [null, undefined, '', '   ', '—', 'nan']) expect(str(v)).toBeNull();
    expect(str(12)).toBe('12');
  });

  it('strId renders identifiers as integers, never with a decimal tail', () => {
    expect(strId(2017331334)).toBe('2017331334');
    expect(strId(2017331334.0)).toBe('2017331334');
    expect(strId('2017331334.0')).toBe('2017331334');
    expect(strId('2017331334.000')).toBe('2017331334');
    expect(strId(' 20260001 ')).toBe('20260001');
    expect(strId('AB-12')).toBe('AB-12');
  });

  it('strId keeps a genuine decimal string and nulls out blanks', () => {
    expect(strId('123.50')).toBe('123.50');
    for (const v of [null, undefined, '', '—', 'nan', NaN]) expect(strId(v)).toBeNull();
  });

  it('REGRESSION: strId puts a mis-formatted identifier back the way Excel stored it', () => {
    // An IF like 20260323 on a date-formatted column arrives as a Date in year 57370.
    const serial = 20260323;
    const u = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    const asDate = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
    expect(excelSerialFromDate(asDate)).toBe(serial);
    expect(strId(asDate)).toBe('20260323');
  });

  it('strId drops a Date that cannot be a serial (invalid, or before the epoch)', () => {
    expect(strId(new Date('x'))).toBeNull();
    expect(strId(new Date(1800, 0, 1))).toBeNull();
    expect(excelSerialFromDate(new Date('x'))).toBeNull();
  });
});

describe('parseDocStatus', () => {
  it.each([
    ['✅', 'ok'],
    ['✅ Presente', 'ok'],
    ['❌', 'ko'],
    ['🔄', 'prog'],
    ['OK', 'ok'],
    ['ok', 'ok'],
    ['Mancante', 'ko'],
    ['In corso', 'prog'],
    ['book', 'nd'], // "ok" only counts as a whole word
    ['', 'nd'],
    [null, 'nd'],
    ['boh', 'nd'],
  ])('%j -> %s', (input, expected) => {
    expect(parseDocStatus(input)).toBe(expected);
  });
});

describe('normalizeFornitore', () => {
  it.each([
    ['ACCENTURE SPA', 'Accenture'],
    ['Accenture S.p.A.', 'Accenture'],
    ['Deloitte & Touche', 'Deloitte'],
    ['PGMD S.r.l.', 'PGMD'],
    ['Gellify S.p.A.', 'Gellify'],
    ['Intellera Consulting', 'Intellera'],
    ['Qualcun altro', 'Intellera'], // unrecognised falls back to the RTI capofila
    ['', 'Intellera'],
    [null, 'Intellera'],
  ])('%j -> %s', (input, expected) => {
    expect(normalizeFornitore(input)).toBe(expected);
  });
});

describe('header matching', () => {
  it('pick returns the first spelling present, even if its value is null', () => {
    expect(pick({ b: 2, a: 1 }, 'a', 'b')).toBe(1);
    expect(pick({ b: 2 }, 'a', 'b')).toBe(2);
    expect(pick({ a: null, b: 2 }, 'a', 'b')).toBeNull();
    expect(pick({}, 'a')).toBeUndefined();
  });

  it('looseGetter ignores case, accents, punctuation and repeated spaces', () => {
    const g = looseGetter({ '  Numero  Fattura ': 'F1', 'MODALITÀ': 'A corpo', 'Data-Fattura': '2026-01-01' });
    expect(g('numero fattura')).toBe('F1');
    expect(g('Modalità')).toBe('A corpo');
    expect(g('Data Fattura')).toBe('2026-01-01');
    expect(g('Assente')).toBeUndefined();
    expect(g('Assente', 'Numero Fattura')).toBe('F1'); // several spellings, in order
  });

  it('looseGetter treats a present-but-empty cell as found', () => {
    expect(looseGetter({ Fornitore: null })('fornitore')).toBeNull();
  });

  it('isRtiIntellera accepts either supplier column, loosely, and rejects other RTIs', () => {
    expect(isRtiIntellera({ 'Fornitore RTI': 'RTI 7-26 Intellera' })).toBe(true);
    expect(isRtiIntellera({ fornitore: 'rti 7-26 INTELLERA - capofila' })).toBe(true);
    expect(isRtiIntellera({ Fornitore: 'RTI 8-26 Altro' })).toBe(false);
    expect(isRtiIntellera({ Fornitore: null })).toBe(false);
    expect(isRtiIntellera({})).toBe(false);
  });

  it('findSheet prefers an exact name, then a case-insensitive partial match', () => {
    const wb = { SheetNames: ['Foo', 'REPORT Bef 2026', 'Bef'] } as unknown as Workbook;
    expect(findSheet(wb, 'Bef')).toBe('Bef');
    expect(findSheet(wb, 'REPORT Bef')).toBe('REPORT Bef 2026');
    expect(findSheet(wb, 'report bef')).toBe('REPORT Bef 2026');
    expect(findSheet(wb, 'Nope')).toBeNull();
  });
});
