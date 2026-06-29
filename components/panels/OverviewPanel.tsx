'use client';
import React from 'react';
import type { Intervento, RtiConfig } from '@/lib/types';
import { EUR, EUR0, EURM, PCT, MESI, C, erosionRisk } from '@/lib/format';
import { chartMonthly, legchips } from '@/lib/charts';
import { Html } from '../Html';

export default function OverviewPanel({
  IFs,
  rti,
  quotaVal,
  filtersForn,
}: {
  IFs: Intervento[];
  rti: RtiConfig;
  quotaVal: Record<string, number>;
  filtersForn?: string;
}) {
  const conBo = IFs.filter((i) => i.has_bo);
  const senzaBo = IFs.filter((i) => !i.has_bo);
  const tot = IFs.reduce((s, i) => s + i.importo, 0);
  const refs = new Set(IFs.map((i) => i.ref_aria).filter(Boolean));
  const ambs = new Set(IFs.map((i) => i.ambito).filter((a) => a && a !== 'Non classificato'));
  const revM = MESI.map((_, mi) => IFs.reduce((s, i) => s + ((i.rev_mesi && i.rev_mesi[mi]) || 0), 0));
  const revTot = revM.reduce((a, b) => a + b, 0);
  const quota = filtersForn && quotaVal[filtersForn] ? quotaVal[filtersForn] : rti.ceiling;
  const eroPct = quota ? (tot / quota) * 100 : 0;
  const risk = erosionRisk(eroPct);
  const pct = IFs.length ? Math.round((conBo.length / IFs.length) * 100) : 0;

  const refYear = new Date().getFullYear();
  let cum = 0;
  const cumV = revM.map((v) => (cum += v));
  const sum = (a: number[], s: number, e: number) => a.slice(s, e).reduce((x, y) => x + y, 0);

  const stats: [string, string, string][] = [
    ['Valore IF attive', EURM(tot), IFs.length + ' IF'],
    [`Revenue ${refYear} (totale anno)`, EUR(revTot), 'competenza'],
    ['Revenue da gennaio ad oggi', EUR(sum(revM, 0, 6)), 'avanzamento ' + PCT(revTot ? (sum(revM, 0, 6) / revTot) * 100 : 0)],
    ['BO emessi', conBo.length + ' / ' + IFs.length, PCT(pct)],
    ['Quota RTI impegnata', PCT(eroPct), EURM(tot) + ' / ' + EURM(quota)],
  ];

  return (
    <div className="panel on" data-p="0">
      <div className="phead">
        <h2>Overview &amp; KPI</h2>
        <p>Sintesi direzionale del portafoglio IF e dell&apos;andamento revenue.</p>
      </div>
      <div className="kpis">
        <div className="kpi accent">
          <div className="lab">IF attive</div>
          <div className="val">{IFs.length}</div>
          <div className="note">
            {refs.size} referenti ARIA · {ambs.size} ambiti
          </div>
        </div>
        <div className="kpi accent">
          <div className="lab">Valore IF attive</div>
          <div className="val">{EURM(tot)}</div>
          <div className="note">Medio per IF € {EUR0(IFs.length ? tot / IFs.length : 0)}</div>
        </div>
        <div className="kpi amber">
          <div className="lab">Buoni d&apos;Ordine emessi</div>
          <div className="val">
            {conBo.length}
            <small> / {IFs.length}</small>
          </div>
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="note">{senzaBo.length} IF da sbloccare</div>
        </div>
        <div className={'kpi accent' + (risk.level === 'ok' ? '' : ' attn')}>
          <div className="lab">
            Quota RTI impegnata
            {risk.level !== 'ok' && (
              <span
                className="riskpill"
                style={{ background: risk.color }}
                title={`Erosione ${PCT(eroPct)} — soglie: attenzione ≥75%, critico ≥90%`}
              >
                {risk.level === 'over' ? '⚠ ' : ''}
                {risk.label}
              </span>
            )}
          </div>
          <div className="val" style={risk.level === 'ok' ? undefined : { color: risk.color }}>
            {PCT(eroPct)}
          </div>
          <div className="bar">
            <span style={{ width: `${Math.min(100, eroPct).toFixed(1)}%`, background: risk.color }} />
          </div>
          <div className="note">
            {EURM(tot)} su {EURM(quota)}
            {filtersForn ? ' (' + filtersForn + ')' : ' (massimale)'}
            {eroPct > 100 && (
              <b style={{ color: C.bad }}> · +{PCT(eroPct - 100)} oltre quota</b>
            )}
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Revenue mensile · {refYear}</h3>
        <div className="cap">Revenue di competenza per mese · totale vista {EUR(revTot)}</div>
        <Html
          ariaLabel={`Grafico a barre della revenue mensile ${refYear} per la vista corrente. Totale ${EUR(revTot)}, cumulato a fine anno ${EUR(cumV[cumV.length - 1] || 0)}. Valori per mese: ${MESI.map((m, i) => `${m} ${EUR(revM[i] || 0)}`).join(', ')}.`}
          html={chartMonthly(MESI, [{ name: 'Revenue', vals: revM, color: C.petrol }], {
            cumulative: { vals: cumV, color: C.gold, name: 'Cumulato' },
            today: new Date().getMonth(),
            periodLabel: String(refYear),
          })}
        />
        <Html
          className="legrow"
          html={legchips([
            { c: C.petrol, t: 'Revenue mensile' },
            { c: C.gold, t: 'Cumulato' },
            { c: C.amberD, t: 'mese corrente', line: true },
          ])}
        />
      </div>
      <div className="card">
        <h3>Indicatori sintetici</h3>
        <div className="cap">Valori della vista corrente</div>
        <div className="exsum" style={{ marginTop: 4 }}>
          {stats.map((s, i) => (
            <div className="stat" key={i}>
              <div className="l">{s[0]}</div>
              <div className="v">{s[1]}</div>
              <div className="s">{s[2]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
