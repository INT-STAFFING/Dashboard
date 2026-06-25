'use client';
import React, { useState } from 'react';
import type { Intervento, RtiConfig, Meta } from '@/lib/types';
import { EUR, EURM, PCT, FCOL, C } from '@/lib/format';
import { donut, hbars, esc } from '@/lib/charts';
import { Html } from '../Html';

function buildYearlyErosionChart(
  years: number[],
  impByYear: Record<number, number>,
  annualQuota: number,
  todayYear: number,
): string {
  const W = 920, H = 260, pl = 76, pr = 18, pt = 20, pb = 44;
  const pw = W - pl - pr, ph = H - pt - pb;
  const maxV = Math.max(annualQuota * 1.25, ...Object.values(impByYear), 1);
  const ticks = 4;
  const yOf = (v: number) => pt + ph - (v / maxV) * ph;
  const slot = pw / years.length;
  const bw = Math.min(slot * 0.5, 80);

  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxV * i) / ticks, y = yOf(v);
    g += `<line x1="${pl}" y1="${y.toFixed(1)}" x2="${W - pr}" y2="${y.toFixed(1)}" stroke="${C.line}"/>`;
    g += `<text x="${pl - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11.5" fill="${C.muted}">€${(v / 1e6).toFixed(1)}M</text>`;
  }

  // annual quota reference line
  const qy = yOf(annualQuota);
  g += `<line x1="${pl}" y1="${qy.toFixed(1)}" x2="${(W - pr).toFixed(1)}" y2="${qy.toFixed(1)}" stroke="${C.amberD}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  g += `<text x="${(W - pr - 4).toFixed(1)}" y="${(qy - 5).toFixed(1)}" text-anchor="end" font-size="10" fill="${C.amberD}">budget/anno</text>`;

  let bars = '', labs = '';
  years.forEach((yr, i) => {
    const cx = pl + slot * i + slot / 2;
    const v = impByYear[yr] || 0;
    const y = yOf(v);
    const isPast = yr < todayYear;
    const isToday = yr === todayYear;
    const col = isToday ? C.petrol : isPast ? C.petrolD : C.petrolL;
    bars += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(pt + ph - y).toFixed(1)}" rx="4" fill="${col}" class="seg" data-tip="${esc(`${yr}\nImpegnato: ${EUR(v)}\nBudget annuo: ${EUR(annualQuota)}`)}"/>`;
    if (v > 0) {
      bars += `<text x="${cx.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.ink}">${(v / 1e6).toFixed(1)}M</text>`;
    }
    labs += `<text x="${cx.toFixed(1)}" y="${H - pb + 18}" text-anchor="middle" font-size="13" font-weight="${isToday ? '700' : '400'}" fill="${isToday ? C.ink : C.muted}">${yr}</text>`;
  });

  // today marker
  let mk = '';
  const todayIdx = years.indexOf(todayYear);
  if (todayIdx >= 0) {
    const mx = pl + slot * todayIdx + slot / 2;
    mk = `<line x1="${mx.toFixed(1)}" y1="${pt}" x2="${mx.toFixed(1)}" y2="${pt + ph}" stroke="${C.amberD}" stroke-width="1.3" stroke-dasharray="4 3"/>`;
    mk += `<text x="${(mx + 5).toFixed(1)}" y="${pt + 13}" text-anchor="start" font-size="10" fill="${C.amberD}" font-weight="700">oggi</text>`;
  }

  return `<svg class="msvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}${bars}${mk}${labs}</svg>`;
}

export default function RTIPanel({
  IFs,
  rti,
  meta,
  quotaVal,
  filtersForn,
  rtiSel,
  setRtiSel,
  editMode,
  onUpdateRti,
}: {
  IFs: Intervento[];
  rti: RtiConfig;
  meta: Meta;
  quotaVal: Record<string, number>;
  filtersForn?: string;
  rtiSel: string | null;
  setRtiSel: (v: string | null) => void;
  editMode: boolean;
  onUpdateRti: (u: { massimale_totale: number; quota_intellera_pct: number; quota_deloitte_pct: number }) => void;
}) {
  const impByP: Record<string, number> = {};
  rti.partners.forEach((p) => (impByP[p.name] = 0));
  IFs.forEach((i) => {
    if (impByP[i.fornitore] != null) impByP[i.fornitore] += i.importo;
  });
  const selP = rtiSel || (filtersForn && quotaVal[filtersForn] ? filtersForn : null);
  const ceil = rti.ceiling;

  const donutHtml = donut(
    rti.partners.map((p) => ({
      label: `${p.name} · ${PCT(p.pct * 100)} · ${EURM(p.quota)}`,
      v: p.quota,
      c: FCOL[p.name] || C.slateL,
      drillRti: p.name,
      tip: `${p.name}\nQuota ${PCT(p.pct * 100)} · ${EUR(p.quota)}\nclic per vedere la sua erosione`,
    })),
    selP
      ? EURM(quotaVal[selP]).replace('€ ', '').replace(' Mln', '')
      : EURM(rti.ceiling).replace('€ ', '').replace(' Mln', ''),
    selP ? 'Mln quota ' + selP : 'Mln massimale contr.',
  );

  const eroPartner = hbars(
    rti.partners.map((p) => {
      const im = impByP[p.name] || 0;
      const pc = p.quota ? (im / p.quota) * 100 : 0;
      return {
        label: p.name,
        v: pc,
        disp: EURM(im),
        sub: '/ ' + EURM(p.quota) + ' · ' + PCT(pc),
        c: FCOL[p.name] || C.slateL,
        tip: `${p.name}\nImpegnato ${EUR(im)} su quota ${EUR(p.quota)}\nErosione ${PCT(pc)}`,
      };
    }),
    undefined,
    { max: 100 },
  );

  // Yearly erosion
  const startYear = new Date(meta.contract_date).getFullYear();
  const endYear = new Date(meta.valid_to).getFullYear();
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
  const annualQuota = ceil / years.length;
  const todayYear = new Date().getFullYear();

  const impByYear: Record<number, number> = {};
  years.forEach((y) => (impByYear[y] = 0));
  IFs.forEach((i) => {
    const y = i.data_inizio ? new Date(i.data_inizio).getFullYear() : startYear;
    if (impByYear[y] != null) impByYear[y] += i.importo;
    else impByYear[startYear] += i.importo;
  });

  const totImpegnato = IFs.reduce((s, i) => s + i.importo, 0);
  const eroTotPct = ceil ? (totImpegnato / ceil) * 100 : 0;

  const eroAnnoSvg = buildYearlyErosionChart(years, impByYear, annualQuota, todayYear);
  const eroAnnoHtml = `<div>
    <div class="erohead" style="margin-bottom:12px">
      <div class="erorow"><span>Massimale contrattuale</span><b>${EURM(ceil)}</b></div>
      <div class="erotrack"><div class="erofill" style="width:${Math.max(eroTotPct, 2).toFixed(1)}%">${PCT(eroTotPct)}</div></div>
      <div class="eroleg"><span>Impegnato totale <b>${EURM(totImpegnato)}</b></span><span>Residuo <b>${EURM(ceil - totImpegnato)}</b></span></div>
    </div>
    ${eroAnnoSvg}
    <div style="font-size:11px;color:var(--muted);margin-top:6px">
      Contratto ${meta.contract_date} → ${meta.valid_to} · Budget annuo stimato ${EURM(annualQuota)} · IF/BO raggruppati per anno di inizio
    </div>
  </div>`;

  const onDonutClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('[data-drill-rti]') as HTMLElement | null;
    if (target) {
      const p = target.getAttribute('data-drill-rti');
      setRtiSel(rtiSel === p ? null : p);
    }
  };

  return (
    <div className="panel on" data-p="1">
      <div className="phead">
        <h2>Quote RTI ed erosione</h2>
        <p>Composizione del raggruppamento ed erosione del massimale e delle quote.</p>
      </div>
      {editMode && <RtiConfigForm rti={rti} onUpdate={onUpdateRti} />}
      <div className="grid2">
        <div className="card">
          <h3>Composizione del RTI</h3>
          <div className="cap">Quota contrattuale per partner sul massimale contrattuale</div>
          <Html html={donutHtml} onClick={onDonutClick} />
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
            {selP ? (
              <>
                Stai vedendo la quota di <b>{selP}</b>.{' '}
                <a
                  href="#"
                  style={{ color: 'var(--petrol-d)' }}
                  onClick={(e) => {
                    e.preventDefault();
                    setRtiSel(null);
                  }}
                >
                  ↺ mostra intero massimale
                </a>
              </>
            ) : (
              "Clic su uno spicchio per vedere l'erosione della quota di quel partner ↗"
            )}
          </div>
        </div>
        <div className="card">
          <h3>Erosione della quota per partner RTI</h3>
          <div className="cap">
            Valore impegnato (IF/BO della vista) rispetto alla quota contrattuale di ciascun partner
          </div>
          <Html html={eroPartner} />
        </div>
      </div>
      <div className="card">
        <h3>Erosione per Anno</h3>
        <div className="cap">
          Impegnato (IF/BO della vista) distribuito per anno lungo la durata contrattuale
        </div>
        <Html html={eroAnnoHtml} />
      </div>
    </div>
  );
}

function RtiConfigForm({
  rti,
  onUpdate,
}: {
  rti: RtiConfig;
  onUpdate: (u: { massimale_totale: number; quota_intellera_pct: number; quota_deloitte_pct: number }) => void;
}) {
  const intq = rti.partners.find((p) => p.name === 'Intellera')?.pct ?? 0.65;
  const delq = rti.partners.find((p) => p.name === 'Deloitte')?.pct ?? 0.2;
  const [open, setOpen] = useState(false);
  const [mass, setMass] = useState(rti.ceiling);
  const [intPct, setIntPct] = useState(Math.round(intq * 100));
  const [delPct, setDelPct] = useState(Math.round(delq * 100));

  if (!open) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button className="freset" onClick={() => setOpen(true)} style={{ borderColor: 'var(--petrol)', color: 'var(--petrol-d)' }}>
          ⚙️ Configura parametri RTI
        </button>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h3>Parametri RTI</h3>
      <div className="formgrid">
        <label>
          Massimale contrattuale (€)
          <input type="number" value={mass} onChange={(e) => setMass(Number(e.target.value))} />
        </label>
        <label>
          Quota % Intellera
          <input
            type="number"
            value={intPct}
            onChange={(e) => {
              const v = Number(e.target.value);
              setIntPct(v);
              setDelPct(100 - v);
            }}
          />
        </label>
        <label>
          Quota % Deloitte (auto)
          <input type="number" value={delPct} readOnly />
        </label>
      </div>
      <div className="formbtns">
        <button
          className="addbtn"
          onClick={() => {
            onUpdate({ massimale_totale: mass, quota_intellera_pct: intPct, quota_deloitte_pct: delPct });
            setOpen(false);
          }}
        >
          Aggiorna
        </button>
        <button className="clearbtn" onClick={() => setOpen(false)}>
          Annulla
        </button>
      </div>
    </div>
  );
}
