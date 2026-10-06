import { describe, expect, it } from 'vitest';
import { C } from '@/lib/format';
import { chartMonthly, chartRevFatt, chartVBars, donut, esc, hbars, hbarsStacked, legchips } from '@/lib/charts';

const count = (html: string, needle: string | RegExp) => (html.match(typeof needle === 'string' ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : needle) ?? []).length;
const MESI3 = ['Gen', 'Feb', 'Mar'];

describe('esc', () => {
  it('escapes the characters that could break out of an attribute or a tag', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
  it('turns null/undefined into an empty string and numbers into text', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(42)).toBe('42');
  });
});

describe('donut', () => {
  it('draws one arc per non-empty segment and a chip per segment', () => {
    const html = donut([{ label: 'A', v: 3, c: '#111' }, { label: 'B', v: 0, c: '#222' }, { label: 'C', v: 1, c: '#333' }], 4, 'IF');
    expect(count(html, 'class="seg"')).toBe(2);
    expect(count(html, 'class="chip"')).toBe(3);
    expect(html).toContain('>4</text>');
    expect(html).toContain('>IF</text>');
  });

  it('shows an empty ring (no arcs) when there is nothing to show', () => {
    const html = donut([{ label: 'A', v: 0, c: '#111' }], '', '');
    expect(count(html, 'class="seg"')).toBe(0);
    expect(html).toContain(C.line);
    expect(html).not.toContain('<text');
  });

  it('carries the tooltip and drill-down hooks, escaped', () => {
    const html = donut([{ label: 'X<y>', v: 1, c: '#111', tip: 'tip "q"', drillStato: 'approvato', drillRti: 'Intellera' }], 1, 'a');
    expect(html).toContain('data-tip="tip &quot;q&quot;"');
    expect(html).toContain('data-drill-stato="approvato"');
    expect(html).toContain('data-drill-rti="Intellera"');
    expect(html).toContain('X&lt;y&gt;');
    expect(html).not.toContain('X<y>');
  });

  it('never produces NaN', () => {
    expect(donut([], 0, '')).not.toContain('NaN');
  });
});

describe('hbars', () => {
  const rows = [{ label: 'Uno', v: 50, disp: '50' }, { label: 'Due', v: 100, disp: '100', sub: 'sotto' }];

  it('scales each bar against the largest value', () => {
    const html = hbars(rows);
    expect(html).toContain('width:50.0%');
    expect(html).toContain('width:100.0%');
    expect(html).toContain('<span class="hsub">sotto</span>');
  });

  it('honours an explicit max and never overflows 100%', () => {
    expect(hbars(rows, undefined, { max: 200 })).toContain('width:25.0%');
    expect(hbars([{ label: 'x', v: 500, disp: '500' }], undefined, { max: 100 })).toContain('width:100.0%');
  });

  it('colours by row, then by argument, then by the default', () => {
    expect(hbars([{ label: 'x', v: 1, disp: '1', c: '#aaa' }], '#bbb')).toContain('background:#aaa');
    expect(hbars([{ label: 'x', v: 1, disp: '1' }], '#bbb')).toContain('background:#bbb');
    expect(hbars([{ label: 'x', v: 1, disp: '1' }])).toContain(C.petrolL);
  });

  it('copes with no rows and escapes labels', () => {
    expect(hbars([])).toBe('<div class="hbars"></div>');
    expect(hbars([{ label: '<b>', v: 1, disp: '"1"' }])).not.toContain('<b>');
  });
});

describe('hbarsStacked', () => {
  it('draws only the positive segments, sized against the max', () => {
    const html = hbarsStacked([{ label: 'A', total: 10, disp: '10', tip: 't', segs: [{ v: 5, c: '#1' }, { v: 0, c: '#2' }, { v: 5, c: '#3' }] }], { max: 20 });
    expect(count(html, 'class="hsseg"')).toBe(2);
    expect(html).toContain('width:25.00%');
  });
});

describe('chartMonthly', () => {
  const series = [{ name: 'Revenue', vals: [10, 20, 30], color: '#0a0' }];

  it('draws a bar per month and series, with a tooltip naming the period', () => {
    const html = chartMonthly(MESI3, [...series, { name: 'Altro', vals: [1, 2, 3], color: '#00a' }], { periodLabel: '2031' });
    expect(count(html, '<rect')).toBe(6);
    expect(html).toContain('Gen 2031 · Revenue');
    expect(html).toContain('Mar 2031 · Altro');
  });

  it('REGRESSION: the period in the tooltips comes from the caller, not from a hardcoded year', () => {
    expect(chartMonthly(MESI3, series, { periodLabel: '2027' })).not.toContain('2026');
    expect(chartMonthly(MESI3, series)).not.toMatch(/Gen \d{4}/);
  });

  it('adds the cumulative line with a point per month', () => {
    const html = chartMonthly(MESI3, series, { cumulative: { vals: [10, 30, 60], color: '#fa0', name: 'Cumulato' } });
    expect(count(html, '<polyline')).toBe(1);
    expect(count(html, '<circle')).toBe(3);
    expect(html).toContain('Cumulato');
  });

  it('shows the "oggi" marker only for an index inside the chart', () => {
    expect(chartMonthly(MESI3, series, { today: 1 })).toContain('>oggi<');
    expect(chartMonthly(MESI3, series, { today: -1 })).not.toContain('>oggi<');
    expect(chartMonthly(MESI3, series, { today: 3 })).not.toContain('>oggi<');
    expect(chartMonthly(MESI3, series)).not.toContain('>oggi<');
  });

  it('never produces NaN, even with all-zero data', () => {
    const html = chartMonthly(MESI3, [{ name: 'x', vals: [0, 0, 0], color: '#000' }], { cumulative: { vals: [0, 0, 0], color: '#000', name: 'c' } });
    expect(html).not.toContain('NaN');
  });
});

describe('legchips', () => {
  it('renders a dot, a line or a dashed marker per item, escaped', () => {
    const html = legchips([{ c: '#111', t: 'Punto' }, { c: '#222', t: 'Linea', line: true }, { c: '#333', t: 'Trat<>', dash: true }]);
    expect(count(html, 'class="chip"')).toBe(3);
    expect(html).toContain('height:3px');
    expect(html).toContain('border-top:2px dashed #333');
    expect(html).toContain('Trat&lt;&gt;');
    expect(legchips([])).toBe('');
  });
});

describe('chartVBars', () => {
  it('draws a bar and a value label per item, with the drill hook only when given', () => {
    const html = chartVBars([{ label: 'A corpo', val: 7, color: '#1', tip: 'tip A', drill: 'a corpo' }, { label: 'B', val: 3, color: '#2', tip: 'tip B' }]);
    expect(count(html, 'class="seg"')).toBe(2);
    expect(html).toContain('data-drill-mod="a corpo"');
    expect(count(html, 'data-drill-mod')).toBe(1);
    expect(html).toContain('>7</text>');
  });

  it('copes with an empty list', () => {
    const html = chartVBars([]);
    expect(html).toContain('<svg');
    expect(html).not.toContain('NaN');
  });
});

describe('chartRevFatt', () => {
  const labels = ['Gen', 'Feb', 'Mar'];

  it('draws revenue and fatturazione bars, their cumulative lines and a hover column per period', () => {
    const html = chartRevFatt(labels, [10, 20, 30], [5, 5, 5], [], -1, '2027');
    expect(count(html, '<rect')).toBe(6 + 3); // 2 bars x 3 months + 3 hover columns
    expect(count(html, '<polyline')).toBe(2);
    expect(html).toContain('Gen 2027');
    expect(html).toContain('Cum. Revenue');
    expect(html).not.toContain('(BEF)');
  });

  it('adds the invoiced (BEF) series — a third bar, a third line, extra tooltip lines — only when there is any', () => {
    const html = chartRevFatt(labels, [10, 20, 30], [5, 5, 5], [0, 100, 0], -1);
    expect(count(html, '<rect')).toBe(9 + 3);
    expect(count(html, '<polyline')).toBe(3);
    expect(html).toContain('Fatturato (BEF)');
    expect(html).toContain('Cum. Fatturato (BEF)');
    expect(chartRevFatt(labels, [1, 1, 1], [1, 1, 1], [0, 0, 0], -1)).not.toContain('(BEF)');
  });

  it('puts the "oggi" marker at the given month, if inside the chart', () => {
    expect(chartRevFatt(labels, [1, 1, 1], [1, 1, 1], [], 1)).toContain('>oggi<');
    expect(chartRevFatt(labels, [1, 1, 1], [1, 1, 1], [], -1)).not.toContain('>oggi<');
    expect(chartRevFatt(labels, [1, 1, 1], [1, 1, 1], [], 3)).not.toContain('>oggi<');
  });

  it('REGRESSION: the period label is the caller\'s — no hardcoded year anywhere in the chart', () => {
    expect(chartRevFatt(labels, [1, 1, 1], [1, 1, 1], [], -1, 'Set 2028–Ago 2029')).toContain('Gen Set 2028–Ago 2029');
    expect(chartRevFatt(labels, [1, 1, 1], [1, 1, 1], [], -1)).not.toMatch(/20\d\d/);
  });

  it('never produces NaN with all-zero data', () => {
    expect(chartRevFatt(labels, [0, 0, 0], [0, 0, 0], [0, 0, 0], -1)).not.toContain('NaN');
  });
});
