'use client';
import React, { useMemo, useState } from 'react';
import type { MultiYearTimeline, BefMonthly, BefAggregates } from '@/lib/types';
import { EUR, EUR2, PCT, C } from '@/lib/format';
import {
  type Calendar,
  availableYears,
  yearSeriesMonthly,
  yearSeriesQuarterly,
  yearSeriesMonthlyMap,
  yearSeriesQuarterlyMap,
  todayIndex,
} from '@/lib/fiscal';
import { chartRevFatt, legchips } from '@/lib/charts';
import { Html } from '../Html';

function TimelinePanel({
  timelineMy,
  befMonthly,
  befAggregates,
  tlMode,
  setTlMode,
}: {
  timelineMy: MultiYearTimeline;
  befMonthly: BefMonthly[];
  befAggregates: BefAggregates;
  tlMode: 'mese' | 'trim';
  setTlMode: (m: 'mese' | 'trim') => void;
}) {
  const months = timelineMy.months;
  const befMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of befMonthly) m.set(`${r.anno}-${r.mese}`, r.totale);
    return m;
  }, [befMonthly]);
  const [cal, setCal] = useState<Calendar>('solare');
  const now = new Date();
  const currentYear = now.getFullYear();
  // A fiscal year labeled Y spans Set(Y)..Ago(Y+1), so the fiscal year that
  // actually contains "today" is last year's calendar label whenever today's
  // month is before September (e.g. in Jul 2026 we're inside FY2025, not FY2026).
  const currentFiscalYear = now.getMonth() + 1 >= 9 ? currentYear : currentYear - 1;
  // null = the user hasn't explicitly picked a year yet, so the default should
  // track "today" for whichever calendar is active (solare vs fiscale).
  const [year, setYear] = useState<number | null>(null);

  // Selectable years depend on the calendar; fall back to the year that
  // actually contains "today" for the active calendar, then to the latest
  // year with data, so the panel always opens on the current period.
  const years = availableYears(months, cal);
  const defaultYear = cal === 'fiscale' ? currentFiscalYear : currentYear;
  const effYear = year != null && years.includes(year)
    ? year
    : years.includes(defaultYear)
      ? defaultYear
      : years[years.length - 1] ?? defaultYear;

  const periodLabel =
    cal === 'solare' ? `${effYear}` : `Set ${effYear}–Ago ${effYear + 1}`;

  const series = (metric: 'revenue' | 'consuntivato') =>
    tlMode === 'trim'
      ? yearSeriesQuarterly(months, effYear, cal, metric)
      : yearSeriesMonthly(months, effYear, cal, metric);

  const revB = series('revenue');
  const fattB = series('consuntivato');
  const befB =
    tlMode === 'trim'
      ? yearSeriesQuarterlyMap(befMap, effYear, cal)
      : yearSeriesMonthlyMap(befMap, effYear, cal);
  const labels = revB.map((b) => b.label);
  const rev = revB.map((b) => b.value);
  const fatt = fattB.map((b) => b.value);
  const bef = befB.map((b) => b.value);

  const monthToday = todayIndex(effYear, cal);
  const today =
    monthToday < 0 ? -1 : tlMode === 'trim' ? Math.floor(monthToday / 3) : monthToday;

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const totR = sum(rev);
  const totF = sum(fatt);
  const totBef = sum(bef);
  const hasBef = bef.some((v) => v > 0);
  const upto = today < 0 ? 0 : today + 1;
  const matR = rev.slice(0, upto).reduce((x, y) => x + y, 0);
  const modeTxt = tlMode === 'trim' ? 'trimestrale' : 'mensile';
  const calTxt = cal === 'solare' ? 'anno solare' : 'anno fiscale';

  const stats: [string, string, string][] = [
    ['Revenue totale', EUR(totR), `competenza · ${calTxt} ${periodLabel}`],
    ['Valore IF Attivate', EUR(totF), 'consuntivato/fatturabile'],
    ['Revenue maturata ad oggi', EUR(matR), 'avanzamento ' + PCT(totR ? (matR / totR) * 100 : 0)],
    // I quattro indicatori BEF sono di portafoglio (tutte le annualità
    // caricate), non filtrati sull'anno selezionato come il resto del
    // pannello: le righe ancora da emettere non portano una data su cui
    // bucketizzarle. Il sottotitolo lo dichiara per non lasciar leggere il
    // valore come "del periodo mostrato nel grafico". "Fatturabile ad oggi",
    // "Fatturato in attesa" e "Fatturato emesso" sono mutuamente esclusivi e
    // sommano al totale BEF Intellera; "Fatturato incassato" è un
    // SOTTOINSIEME di "Fatturato emesso" (non va sommato una seconda volta).
    ['Fatturabile ad oggi', EUR2(befAggregates.fatturabile), 'da emettere · Intellera · tutti i periodi'],
    ['Fatturato in attesa', EUR2(befAggregates.fatturatoInAttesa), 'emesso, non approvato dal cliente · tutti i periodi'],
    ['Fatturato emesso', EUR2(befAggregates.fatturatoEmesso), 'incassato o meno · Intellera · tutti i periodi'],
    ['Fatturato incassato', EUR2(befAggregates.fatturatoIncassato), 'di cui già incassato · tutti i periodi'],
  ];

  return (
    <div className="panel on" data-p="2">
      <div className="phead">
        <h2>Timeline finanziaria — Intellera Consulting</h2>
        <div className="tl-controls">
          <select
            className="tl-year"
            value={effYear}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Anno"
          >
            {years.length === 0 && <option value={currentYear}>{currentYear}</option>}
            {years.map((y) => (
              <option key={y} value={y}>
                {cal === 'solare' ? y : `${y}/${String((y + 1) % 100).padStart(2, '0')}`}
              </option>
            ))}
          </select>
          <div className="seg2 small">
            <button className={cal === 'solare' ? 'on' : ''} onClick={() => setCal('solare')}>
              Solare
            </button>
            <button className={cal === 'fiscale' ? 'on' : ''} onClick={() => setCal('fiscale')}>
              Fiscale
            </button>
          </div>
          <div className="seg2">
            <button className={tlMode === 'mese' ? 'on' : ''} onClick={() => setTlMode('mese')}>
              Mensile
            </button>
            <button className={tlMode === 'trim' ? 'on' : ''} onClick={() => setTlMode('trim')}>
              Trimestrale
            </button>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>
          Revenue vs Fatturazione — {modeTxt} · {calTxt} {periodLabel}
        </h3>
        <div className="cap">
          Barre: valori per periodo · Linee: cumulati · solo fornitore Intellera Consulting
          {hasBef ? ` · Fatturato BEF ${calTxt} ${periodLabel}: ${EUR2(totBef)}` : ''}
        </div>
        <Html
          ariaLabel={`Revenue vs fatturazione (${modeTxt}, ${calTxt} ${periodLabel}). Revenue totale ${EUR(totR)}, fatturazione totale ${EUR(totF)}${
            hasBef ? `, fatturato BEF totale ${EUR(totBef)}` : ''
          }. Per periodo: ${labels
            .map(
              (l, i) =>
                `${l} revenue ${EUR(rev[i])} fatturazione ${EUR(fatt[i])}${
                  hasBef ? ` fatturato BEF ${EUR(bef[i])}` : ''
                }`,
            )
            .join('; ')}.`}
          html={chartRevFatt(labels, rev, fatt, bef, today, periodLabel)}
        />
        <Html
          className="legrow"
          html={legchips([
            { c: C.petrol, t: 'Revenue' },
            { c: C.gold, t: 'Fatturazione' },
            ...(hasBef ? [{ c: C.slate, t: 'Fatturato (BEF)' }] : []),
            { c: C.petrolD, t: 'Cum. Revenue', line: true },
            { c: C.amberD, t: 'Cum. Fatturazione', dash: true },
            ...(hasBef ? [{ c: C.slate, t: 'Cum. Fatturato (BEF)', dash: true }] : []),
          ])}
        />
      </div>
      <div className="exsum" style={{ marginTop: 22 }}>
        {stats.map((s, i) => (
          <div className="stat" key={i}>
            <div className="l">{s[0]}</div>
            <div className="v">{s[1]}</div>
            <div className="s">{s[2]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Memoized: only the active tab is mounted, but edits elsewhere in the
// Dashboard (toasts, drawer, saving flags) re-render the parent — memo skips
// re-rendering the panel when its own data/props are unchanged.
export default React.memo(TimelinePanel);
