'use client';
import React from 'react';
import type { Timeline } from '@/lib/types';
import { EUR, EUR2, PCT, MESI, C, FATTURATO_EMESSO } from '@/lib/format';
import { chartRevFatt, legchips } from '@/lib/charts';
import { Html } from '../Html';

export default function TimelinePanel({
  timeline,
  tlMode,
  setTlMode,
}: {
  timeline: Timeline;
  tlMode: 'mese' | 'trim';
  setTlMode: (m: 'mese' | 'trim') => void;
}) {
  let labels: string[], rev: number[], fatt: number[], today: number, modeTxt: string;
  if (tlMode === 'trim') {
    const q = (a: number[]) => [0, 1, 2, 3].map((k) => a.slice(k * 3, k * 3 + 3).reduce((x, y) => x + y, 0));
    labels = ['1° trim.', '2° trim.', '3° trim.', '4° trim.'];
    rev = q(timeline.revenue_2026);
    fatt = q(timeline.consuntivazione_2026);
    today = 1;
    modeTxt = 'trimestrale';
  } else {
    labels = MESI;
    rev = timeline.revenue_2026;
    fatt = timeline.consuntivazione_2026;
    today = 5;
    modeTxt = 'mensile';
  }
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const totR = sum(rev),
    totF = sum(fatt);
  const matR = rev.slice(0, today + 1).reduce((x, y) => x + y, 0);
  const matF = fatt.slice(0, today + 1).reduce((x, y) => x + y, 0);

  const stats: [string, string, string][] = [
    ['Revenue totale 2026', EUR(totR), 'competenza'],
    ['Fatturazione totale 2026', EUR(totF), 'consuntivato/fatturabile'],
    ['Revenue maturata ad oggi', EUR(matR), 'avanzamento ' + PCT(totR ? (matR / totR) * 100 : 0)],
    ['Fatturabile ad oggi', EUR(matF), 'avanzamento ' + PCT(totF ? (matF / totF) * 100 : 0)],
    ['Fatturato emesso', EUR2(FATTURATO_EMESSO.totale), FATTURATO_EMESSO.voci[0].nome + ' · BO ' + FATTURATO_EMESSO.voci[0].bo],
  ];

  return (
    <div className="panel on" data-p="2">
      <div className="phead">
        <h2>Timeline finanziaria</h2>
        <div className="seg2">
          <button className={tlMode === 'mese' ? 'on' : ''} onClick={() => setTlMode('mese')}>
            Mensile
          </button>
          <button className={tlMode === 'trim' ? 'on' : ''} onClick={() => setTlMode('trim')}>
            Trimestrale
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Revenue vs Fatturazione — {modeTxt} 2026</h3>
        <div className="cap">
          Barre: valori per periodo · Linee: cumulati annui · intero portafoglio contrattuale
        </div>
        <Html html={chartRevFatt(labels, rev, fatt, today)} />
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
