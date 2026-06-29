'use client';
import React, { useState } from 'react';
import type { MultiYearTimeline } from '@/lib/types';
import { EUR, EUR2, PCT, C, FATTURATO_EMESSO } from '@/lib/format';
import {
  type Calendar,
  availableYears,
  yearSeriesMonthly,
  yearSeriesQuarterly,
  todayIndex,
} from '@/lib/fiscal';
import { chartRevFatt, legchips } from '@/lib/charts';
import { Html } from '../Html';

export default function TimelinePanel({
  timelineMy,
  tlMode,
  setTlMode,
}: {
  timelineMy: MultiYearTimeline;
  tlMode: 'mese' | 'trim';
  setTlMode: (m: 'mese' | 'trim') => void;
}) {
  const months = timelineMy.months;
  const [cal, setCal] = useState<Calendar>('solare');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);

  // Selectable years depend on the calendar; fall back to the current year, then
  // to the latest year with data, so the panel always shows something coherent.
  const years = availableYears(months, cal);
  const effYear = years.includes(year)
    ? year
    : years.includes(currentYear)
      ? currentYear
      : years[years.length - 1] ?? currentYear;

  const periodLabel =
    cal === 'solare' ? `${effYear}` : `Set ${effYear}–Ago ${effYear + 1}`;

  const series = (metric: 'revenue' | 'consuntivato') =>
    tlMode === 'trim'
      ? yearSeriesQuarterly(months, effYear, cal, metric)
      : yearSeriesMonthly(months, effYear, cal, metric);

  const revB = series('revenue');
  const fattB = series('consuntivato');
  const labels = revB.map((b) => b.label);
  const rev = revB.map((b) => b.value);
  const fatt = fattB.map((b) => b.value);

  const monthToday = todayIndex(effYear, cal);
  const today =
    monthToday < 0 ? -1 : tlMode === 'trim' ? Math.floor(monthToday / 3) : monthToday;

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const totR = sum(rev);
  const totF = sum(fatt);
  const upto = today < 0 ? 0 : today + 1;
  const matR = rev.slice(0, upto).reduce((x, y) => x + y, 0);
  const matF = fatt.slice(0, upto).reduce((x, y) => x + y, 0);
  const modeTxt = tlMode === 'trim' ? 'trimestrale' : 'mensile';
  const calTxt = cal === 'solare' ? 'anno solare' : 'anno fiscale';

  const stats: [string, string, string][] = [
    ['Revenue totale', EUR(totR), `competenza · ${calTxt} ${periodLabel}`],
    ['Fatturazione totale', EUR(totF), 'consuntivato/fatturabile'],
    ['Revenue maturata ad oggi', EUR(matR), 'avanzamento ' + PCT(totR ? (matR / totR) * 100 : 0)],
    ['Fatturabile ad oggi', EUR(matF), 'avanzamento ' + PCT(totF ? (matF / totF) * 100 : 0)],
    ['Fatturato emesso', EUR2(FATTURATO_EMESSO.totale), FATTURATO_EMESSO.voci[0].nome + ' · BO ' + FATTURATO_EMESSO.voci[0].bo],
  ];

  return (
    <div className="panel on" data-p="2">
      <div className="phead">
        <h2>Timeline finanziaria</h2>
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
          Barre: valori per periodo · Linee: cumulati · intero portafoglio contrattuale
        </div>
        <Html
          ariaLabel={`Revenue vs fatturazione (${modeTxt}, ${calTxt} ${periodLabel}). Revenue totale ${EUR(totR)}, fatturazione totale ${EUR(totF)}. Per periodo: ${labels
            .map((l, i) => `${l} revenue ${EUR(rev[i])} fatturazione ${EUR(fatt[i])}`)
            .join('; ')}.`}
          html={chartRevFatt(labels, rev, fatt, today, periodLabel)}
        />
        <Html
          className="legrow"
          html={legchips([
            { c: C.petrol, t: 'Revenue' },
            { c: C.gold, t: 'Fatturazione' },
            { c: C.petrolD, t: 'Cum. Revenue', line: true },
            { c: C.amberD, t: 'Cum. Fatturazione', dash: true },
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
