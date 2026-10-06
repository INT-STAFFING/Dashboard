import { describe, expect, it } from 'vitest';
import { EROSION_THRESHOLDS, EUR, EUR0, EUR2, EURM, PCT, ambShort, clamp, dfmt, erosionRisk } from '@/lib/format';

describe('erosionRisk thresholds', () => {
  it.each([
    [0, 'ok'],
    [74.9, 'ok'],
    [75, 'warn'],
    [89.9, 'warn'],
    [90, 'critical'],
    [100, 'critical'],
    [100.1, 'over'],
    [250, 'over'],
  ])('%s%% -> %s', (pct, level) => {
    expect(erosionRisk(pct).level).toBe(level);
  });

  it('keeps the product thresholds and a label + colour for every level', () => {
    expect(EROSION_THRESHOLDS).toEqual({ warn: 75, critical: 90 });
    for (const pct of [10, 80, 95, 120]) {
      const r = erosionRisk(pct);
      expect(r.label).toBeTruthy();
      expect(r.color).toMatch(/^#/);
    }
  });
});

describe('number and date formatting (Italian locale)', () => {
  it('formats euros with Italian separators', () => {
    expect(EUR0(1234567)).toBe('1.234.567');
    expect(EUR(1234567)).toBe('€ 1.234.567');
    expect(EUR2(12345.5)).toBe('€ 12.345,50');
    expect(EURM(2_500_000)).toBe('€ 2,50 Mln');
    expect(PCT(12.34)).toBe('12,3%');
  });

  it('follows the Italian convention of not grouping four-digit numbers', () => {
    expect(EUR2(1234.5)).toBe('€ 1234,50');
  });

  it('treats null/NaN-ish amounts as zero', () => {
    expect(EUR0(0)).toBe('0');
    expect(EUR0(NaN)).toBe('0');
    expect(EUR2(null as unknown as number)).toBe('€ 0,00');
  });

  it('formats ISO dates as dd/mm/yy and passes through anything else', () => {
    expect(dfmt('2026-03-05')).toBe('05/03/26');
    expect(dfmt(null)).toBe('—');
    expect(dfmt('boh')).toBe('boh');
  });

  it('clamps long text with an ellipsis and labels missing ambiti', () => {
    expect(clamp('abcdef', 4)).toBe('abc…');
    expect(clamp('abc', 4)).toBe('abc');
    expect(ambShort(null)).toBe('—');
    expect(ambShort('Non classificato')).toBe('—');
    expect(ambShort('Sviluppo')).toBe('Sviluppo');
  });
});
