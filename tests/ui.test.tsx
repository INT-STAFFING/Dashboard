import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '@/components/Dashboard';
import OverviewPanel from '@/components/panels/OverviewPanel';
import RegistroPanel, { exportMatrix } from '@/components/panels/RegistroPanel';
import { getDashboardData } from '@/lib/getDashboardData';
import { persistMesiFromUpload } from '@/lib/mesiStore';
import { SEED_INTERVENTI } from '@/lib/seed';
import type { RtiConfig, SafeUser } from '@/lib/types';
import { makeIf } from './helpers/fixtures';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }), usePathname: () => '/dashboard' }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const CY = new Date().getFullYear();
const m = (...v: number[]): number[] => [...v, ...Array(12 - v.length).fill(0)];
const rti = { ceiling: 1_000_000, partners: [{ name: 'Intellera' }], tot_impegnato: 0, erosione_2026: 0 } as unknown as RtiConfig;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__ARIA_MEM__;
  delete g.__ARIA_MESI__;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('OverviewPanel', () => {
  const ifs = [makeIf({ numero_if: 'A', importo: 50_000, rev_mesi: m(12000, 0, 8000, ...Array(9).fill(0)), has_bo: true })];

  it('labels the revenue KPI with the year it shows', () => {
    const html = text(renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={2031} />));
    expect(html).toContain('Revenue 2031 (totale anno)');
    expect(html).toContain('€ 20.000');
  });

  it('REGRESSION: in the current year it keeps the "from January to today" KPI', () => {
    const html = text(renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={CY} />));
    expect(html).toContain(`Revenue ${CY} (totale anno)`);
    expect(html).toContain('Revenue da gennaio ad oggi');
  });

  it('REGRESSION: the monthly chart is titled, tagged and described with the selected year, not today\'s', () => {
    const html = renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={2031} />);
    expect(html).toContain('Revenue mensile · 2031');
    expect(html).toContain('Grafico a barre della revenue mensile 2031');
    expect(html).toContain('Gen 2031 · Revenue');
    expect(html).not.toContain(`Revenue mensile · ${CY}`);
  });

  it('the "oggi" marker appears in the current year and nowhere else', () => {
    expect(renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={CY} />)).toContain('>oggi<');
    expect(renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={CY - 1} />)).not.toContain('>oggi<');
    expect(renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={CY + 1} />)).not.toContain('>oggi<');
  });

  it('a past year is shown in full as "concluded", a future one as not started', () => {
    const past = text(renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={CY - 1} />));
    expect(past).toContain(`Revenue maturata ${CY - 1} (anno concluso)`);
    expect(past).toContain('avanzamento 100,0%');
    const future = text(renderToStaticMarkup(<OverviewPanel IFs={ifs} rti={rti} quotaVal={{}} anno={CY + 1} />));
    expect(future).toContain(`Revenue maturata ${CY + 1} (anno non iniziato)`);
    expect(future).toContain('avanzamento 0,0%');
  });
});

describe('RegistroPanel', () => {
  const base = { onSaveField: vi.fn(), onOpenEdit: vi.fn(), onOpenNew: vi.fn(), onDelete: vi.fn(), savingIds: new Set<string>(), highlightIds: new Set<string>() };

  it('renders the registry for any year', () => {
    const html = renderToStaticMarkup(<RegistroPanel IFs={[makeIf({ numero_if: 'A', titolo: 'Uno' })]} anno={2027} {...base} />);
    expect(html).toContain('Uno');
  });

  it('REGRESSION: the Excel/CSV export names the revenue column after the year and carries the year total', () => {
    const matrix = exportMatrix([makeIf({ numero_if: 'A', importo: 1000, revenue_anno: 12345.5 })], 2027);
    expect(matrix[0]).toContain('Revenue 2027');
    expect(matrix[0]).not.toContain('Revenue 2026');
    const col = matrix[0].indexOf('Revenue 2027');
    expect(matrix[1][col]).toBe('12345,50');
    expect(matrix[1][matrix[0].indexOf('Importo')]).toBe('1000,00');
  });
});

describe('Dashboard — the year selector', () => {
  const user: SafeUser = { id: 1, email: 'admin@x.it', name: 'Admin', role: 'ADMIN', status: 'approved', created_at: null, approved_at: null };
  const render = async (anno?: number) => {
    const data = await getDashboardData(anno);
    return { data, html: renderToStaticMarkup(<Dashboard initial={data} user={user} canEdit isAdmin />) };
  };
  const select = (html: string) => html.match(/<select[^>]*aria-label="Anno di riferimento"[^>]*>(.*?)<\/select>/s)?.[1] ?? '';

  it('offers every year that has data and marks the selected one', async () => {
    await persistMesiFromUpload([
      { numero_if: SEED_INTERVENTI[0].numero_if, anno: 2027, mese: 1, revenue: 10, consuntivo: 0 },
      { numero_if: SEED_INTERVENTI[0].numero_if, anno: 2025, mese: 1, revenue: 10, consuntivo: 0 },
    ]);
    const { data, html } = await render(2027);
    expect(data.anni).toEqual([2025, 2026, 2027]);
    const opts = [...select(html).matchAll(/<option value="(\d{4})"( selected="")?>/g)].map((x) => [Number(x[1]), Boolean(x[2])]);
    expect(opts).toEqual([[2025, false], [2026, false], [2027, true]]);
  });

  it('REGRESSION: with only the baseline year there is still a selector, on that year', async () => {
    const { data, html } = await render();
    const opts = [...select(html).matchAll(/<option value="(\d{4})"( selected="")?>/g)].map((x) => [Number(x[1]), Boolean(x[2])]);
    expect(opts).toEqual([[data.anno, true]]);
  });

  it('shows the KPI of the year on screen', async () => {
    const { data, html } = await render();
    expect(text(html)).toContain(`Revenue ${data.anno} (totale anno)`);
  });

  it('still renders the rest of the header (CIG, user, links)', async () => {
    const { html } = await render();
    const t = text(html);
    expect(t).toContain('CIG');
    expect(t).toContain('Gestione dati');
    expect(t).toContain('Carica dati');
  });
});
