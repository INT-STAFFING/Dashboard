'use client';
import React from 'react';
import type { Intervento } from '@/lib/types';
import { EUR, EUR0, PCT, C } from '@/lib/format';
import { donut } from '@/lib/charts';
import { Html } from '../Html';

export default function StatoPanel({
  IFs,
  onDrillStato,
}: {
  IFs: Intervento[];
  onDrillStato: (stato: string) => void;
}) {
  const conBo = IFs.filter((i) => i.has_bo);
  const senzaBo = IFs.filter((i) => !i.has_bo);
  const pct = IFs.length ? Math.round((conBo.length / IFs.length) * 100) : 0;

  const stAgg: Record<string, number> = {};
  IFs.forEach((i) => (stAgg[i.stato] = (stAgg[i.stato] || 0) + 1));
  const stcol: Record<string, string> = { approvato: C.good, 'non elaborato': C.gold };
  const stE = Object.entries(stAgg).sort((a, b) => b[1] - a[1]);

  const stBox = IFs.length
    ? donut(
        stE.map((e) => ({
          label: `${e[0]} · ${e[1]} IF`,
          v: e[1],
          c: stcol[e[0]] || C.slateL,
          drillStato: e[0],
          tip: `${e[0]}\n${e[1]} IF · clic per vederle`,
        })),
        IFs.length,
        'IF attive',
      )
    : '<div class="empty">Nessun IF</div>';

  const subIFs = IFs.filter((i) => i.subappalto);
  const onDrill = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = (e.target as HTMLElement).closest('[data-drill-stato]') as HTMLElement | null;
    if (t) onDrillStato(t.getAttribute('data-drill-stato') || '');
  };

  return (
    <div className="panel on" data-p="5">
      <div className="phead">
        <h2>Stato IF / BO e subappalti</h2>
        <p>Stati di lavorazione, copertura Buoni d&apos;Ordine e subappalti.</p>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>IF per stato del BO</h3>
          <div className="cap">
            {IFs.length} IF · {conBo.length} con BO · {senzaBo.length} in attesa
          </div>
          <Html html={stBox} onClick={onDrill} />
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
            Clic su una fetta per vedere gli IF ↗
          </div>
          <div className="exsum" style={{ marginTop: 16 }}>
            {(
              [
                ['IF totali', IFs.length, ' '],
                ['BO emessi', conBo.length, PCT(pct)],
                ['In attesa', senzaBo.length, ' '],
                ['Approvati', stAgg['approvato'] || 0, ' '],
              ] as [string, number, string][]
            ).map((s, i) => (
              <div className="stat" key={i}>
                <div className="l">{s[0]}</div>
                <div className="v">{s[1]}</div>
                <div className="s">{s[2]}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="alert">
          <h3>Da presidiare</h3>
          <div className="cap" style={{ color: 'var(--amber-d)' }}>
            IF ancora privi di Buono d&apos;Ordine (non fatturabili)
          </div>
          <ul className="todo">
            {senzaBo.length ? (
              senzaBo.map((i) => (
                <li key={i.numero_if}>
                  <span className="tag">IF {i.numero_if}</span>
                  <div>
                    <b>{i.titolo}</b>
                    <br />
                    <span style={{ color: 'var(--muted)' }}>
                      In attesa di Buono d&apos;Ordine · Ref. {i.ref_aria} · € {EUR0(i.importo)}
                    </span>
                  </div>
                </li>
              ))
            ) : (
              <li>
                <div className="okstate">✓ Tutti gli IF di questa vista hanno il Buono d&apos;Ordine emesso.</div>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="card">
        <h3>Subappalti</h3>
        <div className="cap">Presenza di subappalto dichiarato sugli IF della vista</div>
        {subIFs.length ? (
          (() => {
            const t = subIFs.reduce((s, i) => s + (i.costo_subappalto || 0), 0);
            const nm = [...new Set(subIFs.flatMap((i) => i.subappaltatore))].filter(Boolean);
            return (
              <div className="subcard">
                <div className="subbadge yes">{subIFs.length}</div>
                <div>
                  <b>{subIFs.length} IF con subappalto</b>
                  <br />
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                    {EUR(t)} subappaltato{nm.length ? ' · ' + nm.join(', ') : ''}
                  </span>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="subcard">
            <div className="subbadge no">0</div>
            <div>
              <b>Nessun subappalto</b>
              <br />
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                Tutte le prestazioni di questa vista sono erogate direttamente dai partner del RTI.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
