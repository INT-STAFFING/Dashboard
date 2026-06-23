'use client';
import React from 'react';
import type { Intervento, ModalitaAgg } from '@/lib/types';
import { EUR, EUR0, PCT, C } from '@/lib/format';
import { donut, chartVBars } from '@/lib/charts';
import { Html } from '../Html';

const MODLAB: Record<string, string> = { A_corpo: 'A corpo', A_canone: 'A canone', A_consumo: 'A consumo', A_misura: 'A misura' };
const DESC: Record<string, string> = {
  A_corpo: 'Fatturazione a consegna milestone',
  A_canone: 'Fatturazione mensile ricorrente',
  A_consumo: 'Fatturazione a misura (GG/Uomo)',
};
const MCOL: Record<string, string> = { A_corpo: C.petrol, A_canone: C.gold, A_consumo: C.slate };
const KEY: Record<string, string> = { A_corpo: 'corpo', A_canone: 'canone', A_consumo: 'consumo' };

export default function ModalitaPanel({
  modalita,
  interventi,
  onDrillMod,
}: {
  modalita: ModalitaAgg[];
  interventi: Intervento[];
  onDrillMod: (modLabel: string) => void;
}) {
  const nIF = (k: string) => interventi.filter((i) => i.modalita_if && i.modalita_if.toLowerCase().includes(k)).length;
  const tot = modalita.reduce((s, m) => s + m.costo, 0) || 1;

  const modDonut = modalita.length
    ? donut(
        modalita.map((m) => ({
          label: `${MODLAB[m.mod] || m.mod} · ${PCT((m.costo / tot) * 100)}`,
          v: m.costo,
          c: MCOL[m.mod] || C.slateL,
          tip: `${MODLAB[m.mod] || m.mod}\n${EUR(m.costo)} · ${PCT((m.costo / tot) * 100)} · ${nIF(KEY[m.mod])} IF`,
        })),
        '',
        '',
      )
    : '<div class="empty">Nessun dato</div>';

  const modBars = modalita.length
    ? chartVBars(
        modalita.map((m) => ({
          label: MODLAB[m.mod] || m.mod,
          val: nIF(KEY[m.mod]),
          color: MCOL[m.mod] || C.slateL,
          drill: MODLAB[m.mod],
          tip: `${MODLAB[m.mod] || m.mod}\nN° IF: ${nIF(KEY[m.mod])}\nN° attività: ${m.n}\nCosto: ${EUR(m.costo)}\n(clic per vedere gli IF)`,
        })),
      )
    : '';

  const onDrill = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = (e.target as HTMLElement).closest('[data-drill-mod]') as HTMLElement | null;
    if (t) onDrillMod(t.getAttribute('data-drill-mod') || '');
  };

  return (
    <div className="panel on" data-p="4">
      <div className="phead">
        <h2>Modalità fornitura</h2>
        <p>Distribuzione per tipologia contrattuale · intero portafoglio.</p>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Distribuzione valore per modalità</h3>
          <div className="cap">Quota del valore per tipologia contrattuale</div>
          <Html html={modDonut} />
        </div>
        <div className="card">
          <h3>N° IF per modalità</h3>
          <div className="cap">Numero di IF per modalità · clic su una barra per vedere gli IF</div>
          <Html html={modBars} onClick={onDrill} />
        </div>
      </div>
      <div className="tablecard">
        <div className="tbar">
          <h3>Dettaglio modalità fornitura</h3>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>clic su una riga per gli IF ↗</span>
        </div>
        <div className="tscroll">
          <table className="dtable">
            <thead>
              <tr>
                <th>Modalità</th>
                <th className="num">N° IF</th>
                <th className="num">N° attività</th>
                <th className="num">Costo totale (€)</th>
                <th className="num">% valore</th>
                <th>Descrizione</th>
              </tr>
            </thead>
            <tbody>
              {modalita.map((m) => (
                <tr key={m.mod} style={{ cursor: 'pointer' }} onClick={() => onDrillMod(MODLAB[m.mod])}>
                  <td>
                    <b>{MODLAB[m.mod] || m.mod}</b>
                  </td>
                  <td className="num">{nIF(KEY[m.mod])}</td>
                  <td className="num">{m.n}</td>
                  <td className="num">{EUR0(m.costo)} €</td>
                  <td className="num">{PCT((m.costo / tot) * 100)}</td>
                  <td style={{ color: 'var(--muted)' }}>{DESC[m.mod] || ''} ↗</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="foot" style={{ marginTop: 14 }}>
        <b>Note:</b> A_corpo = fatturazione a consegna milestone · A_canone = fatturazione mensile ricorrente · A_consumo =
        fatturazione a misura (GG/Uomo).
      </div>
    </div>
  );
}
