'use client';
import React from 'react';
import type { Intervento, Seniority } from '@/lib/types';
import { EUR, EUR0, PCT, clamp, C } from '@/lib/format';
import { hbars, hbarsStacked, donut, legchips } from '@/lib/charts';
import { Html } from '../Html';

const PAL = [C.petrol, C.gold, C.slate, C.petrolL, '#B96E15', '#8C9BB3', '#0A4A43', '#C0492F', '#2F8F5B', '#7A5AA0', '#A100FF', '#D98A2B'];

export default function DistribuzionePanel({
  IFs,
  seniority,
  distSub,
  setDistSub,
}: {
  IFs: Intervento[];
  seniority: Seniority[];
  distSub: number;
  setDistSub: (n: number) => void;
}) {
  const tot = IFs.reduce((s, i) => s + i.importo, 0);

  // 4a — per ambito
  const aAgg: Record<string, { v: number; n: number }> = {};
  IFs.forEach((i) => {
    const k = i.ambito || 'Non classificato';
    (aAgg[k] = aAgg[k] || { v: 0, n: 0 }).v += i.importo;
    aAgg[k].n++;
  });
  const ae = Object.entries(aAgg).sort((a, b) => b[1].v - a[1].v);
  const ambCount = ae.length
    ? hbars(ae.map((e) => ({ label: clamp(e[0], 34), v: e[1].n, disp: e[1].n + '', sub: 'IF', tip: `${e[0]}\n${e[1].n} IF` })), C.petrol)
    : '<div class="empty">Nessun IF in questa vista</div>';
  const ambVal = ae.length
    ? hbars(ae.map((e) => ({ label: clamp(e[0], 34), v: e[1].v, disp: '€ ' + EUR0(e[1].v), tip: `${e[0]}\n${EUR(e[1].v)} · ${e[1].n} IF` })), C.petrolL)
    : '<div class="empty">Nessun IF</div>';

  // 4b — per referente ARIA
  const rAgg: Record<string, { Intellera: number; Deloitte: number; Altro: number; n: number; tot: number }> = {};
  IFs.forEach((i) => {
    const k = i.ref_aria || '—';
    const o = (rAgg[k] = rAgg[k] || { Intellera: 0, Deloitte: 0, Altro: 0, n: 0, tot: 0 });
    if (i.fornitore === 'Intellera') o.Intellera += i.importo;
    else if (i.fornitore === 'Deloitte') o.Deloitte += i.importo;
    else o.Altro += i.importo;
    o.tot += i.importo;
    o.n++;
  });
  const re = Object.entries(rAgg).sort((a, b) => b[1].tot - a[1].tot);
  const refStack = re.length
    ? hbarsStacked(
        re.map(([k, o]) => ({
          label: clamp(k, 24),
          total: o.tot,
          disp: '€ ' + EUR0(o.tot),
          sub: o.n + ' IF',
          segs: [
            { v: o.Intellera, c: C.petrol },
            { v: o.Deloitte, c: C.gold },
            { v: o.Altro, c: C.slateL },
          ],
          tip: `${k}\nIntellera: ${EUR(o.Intellera)}\nDeloitte: ${EUR(o.Deloitte)}\nTotale: ${EUR(o.tot)} · ${o.n} IF`,
        })),
      )
    : '<div class="empty">Nessun IF</div>';

  // 4c — seniority
  const totg = seniority.reduce((s, x) => s + x.gg, 0);
  const tar = (t: number | null) => (t ? t.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '—');
  const senDonut = seniority.length
    ? donut(
        seniority.map((s, i) => ({
          label: `${s.code} · ${EUR0(s.gg)} gg`,
          v: s.gg,
          c: PAL[i % PAL.length],
          tip: `${s.figura} (${s.code})\n${EUR0(s.gg)} GG/uomo${s.tariffa ? ' · ' + tar(s.tariffa) + '/gg' : ''}`,
        })),
        EUR0(totg),
        'GG totali',
      )
    : '<div class="empty">Nessun dato</div>';

  return (
    <div className="panel on" data-p="3">
      <div className="phead">
        <h2>Distribuzione IF</h2>
        <p>Analisi per ambito, referente e seniority.</p>
      </div>
      <div className="subtabs">
        {['4a — Per Ambito', '4b — Per Referente ARIA', '4c — Per Seniority'].map((t, i) => (
          <button key={i} className={distSub === i ? 'on' : ''} onClick={() => setDistSub(i)}>
            {t}
          </button>
        ))}
      </div>

      <div className={'subpanel' + (distSub === 0 ? ' on' : '')}>
        <div className="grid2">
          <div className="card">
            <h3>N° IF per ambito</h3>
            <div className="cap">Numero di Interventi di Fornitura per macro ambito</div>
            <Html html={ambCount} />
          </div>
          <div className="card">
            <h3>Valore (€) per ambito</h3>
            <div className="cap">Valore ordinato per macro ambito</div>
            <Html html={ambVal} />
          </div>
        </div>
        <div className="tablecard">
          <div className="tbar">
            <h3>Dettaglio per ambito</h3>
          </div>
          <div className="tscroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Ambito</th>
                  <th className="num">N° IF</th>
                  <th className="num">Valore (€)</th>
                  <th className="num">% sul totale</th>
                </tr>
              </thead>
              <tbody>
                {ae.length ? (
                  ae.map((e) => (
                    <tr key={e[0]}>
                      <td>{e[0]}</td>
                      <td className="num">{e[1].n}</td>
                      <td className="num">{EUR0(e[1].v)} €</td>
                      <td className="num">{tot ? PCT((e[1].v / tot) * 100) : '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--muted)' }}>
                      Nessun dato
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={'subpanel' + (distSub === 1 ? ' on' : '')}>
        <div className="card">
          <h3>
            Valore per referente ARIA <span style={{ color: 'var(--muted)', fontWeight: 500 }}>(split Intellera / Deloitte)</span>
          </h3>
          <Html
            className="legrow"
            html={legchips([
              { c: C.petrol, t: 'Intellera' },
              { c: C.gold, t: 'Deloitte' },
            ])}
          />
          <Html html={refStack} />
        </div>
        <div className="tablecard">
          <div className="tbar">
            <h3>Dettaglio referenti</h3>
          </div>
          <div className="tscroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Referente ARIA</th>
                  <th className="num">Intellera (€)</th>
                  <th className="num">Deloitte (€)</th>
                  <th className="num">Totale (€)</th>
                  <th className="num">N° IF</th>
                </tr>
              </thead>
              <tbody>
                {re.length ? (
                  re.map(([k, o]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{o.Intellera ? EUR0(o.Intellera) + ' €' : '—'}</td>
                      <td className="num">{o.Deloitte ? EUR0(o.Deloitte) + ' €' : '—'}</td>
                      <td className="num">
                        <b>{EUR0(o.tot)} €</b>
                      </td>
                      <td className="num">{o.n}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--muted)' }}>
                      Nessun dato
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={'subpanel' + (distSub === 2 ? ' on' : '')}>
        <div className="grid2">
          <div className="card">
            <h3>GG/Uomo per figura professionale</h3>
            <div className="cap">Giornate/uomo pianificate · intero portafoglio</div>
            <Html html={senDonut} />
          </div>
          <div className="tablecard">
            <div className="tbar">
              <h3>Figure professionali e tariffe</h3>
            </div>
            <div className="tscroll">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Figura</th>
                    <th>Codice</th>
                    <th className="num">GG/Uomo</th>
                    <th className="num">Tariffa (€/GG)</th>
                  </tr>
                </thead>
                <tbody>
                  {seniority.map((s, i) => (
                    <tr key={i}>
                      <td>{s.figura}</td>
                      <td>
                        <span className="pill" style={{ background: '#EEF2F1', color: 'var(--ink)' }}>
                          {s.code}
                        </span>
                      </td>
                      <td className="num">{EUR0(s.gg)}</td>
                      <td className="num">{tar(s.tariffa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
