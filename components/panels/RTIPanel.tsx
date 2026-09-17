'use client';
import React, { useState } from 'react';
import type { Intervento, RtiConfig, Meta } from '@/lib/types';
import { EUR, EUR0, EURM, PCT, FCOL, C, erosionRisk } from '@/lib/format';
import { donut, hbars, legchips, esc } from '@/lib/charts';
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

type ProjectionSeries = {
  name: string;
  color: string;
  theoreticalEnd: number; // target value at the contract's end date (100 for %, the quota for €)
  realToday: number | null; // actual cumulative value as of today; null if the contract hasn't started yet
};

// Theoretical linear pace vs real erosion, one line per company, on a
// continuous date axis spanning the whole contract (contractStartMs ->
// contractEndMs). The theoretical line is the true straight diagonal from
// 0 on the signing date to its target on the expiry date. The real line
// starts at 0 on the signing date, passes through today's actual value,
// and continues straight (same slope, i.e. "at the current pace") to the
// expiry date — solid for the realised segment, dashed for the projection.
function buildErosionProjectionChart(
  contractStartMs: number,
  contractEndMs: number,
  todayMs: number,
  series: ProjectionSeries[],
  mode: 'pct' | 'eur',
  sharedTheoretical: boolean,
): string {
  const W = 920, H = 300, pl = 76, pr = 18, pt = 20, pb = 44;
  const pw = W - pl - pr, ph = H - pt - pb;
  const totalMs = Math.max(1, contractEndMs - contractStartMs);
  const clampedToday = Math.min(Math.max(todayMs, contractStartMs), contractEndMs);
  const elapsedMs = clampedToday - contractStartMs;

  const projectedEnd = series.map((s) =>
    s.realToday == null ? null : elapsedMs > 0 ? (s.realToday * totalMs) / elapsedMs : s.realToday,
  );

  const rawMax = Math.max(
    1,
    ...series.map((s) => s.theoreticalEnd),
    ...projectedEnd.filter((v): v is number => v != null),
    ...series.map((s) => s.realToday ?? 0),
  );
  const maxV = mode === 'pct' ? Math.max(100, Math.ceil(rawMax / 10) * 10) : rawMax * 1.08;
  const ticks = 4;
  const yOf = (v: number) => pt + ph - (v / maxV) * ph;
  const xOf = (ms: number) => pl + pw * ((ms - contractStartMs) / totalMs);
  const fmtAxis = (v: number) => (mode === 'pct' ? `${Math.round(v)}%` : `€${(v / 1e6).toFixed(1)}M`);
  const fmtVal = (v: number) => (mode === 'pct' ? PCT(v) : EURM(v));
  const fmtDelta = (v: number) => (mode === 'pct' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} p.p.` : `${v >= 0 ? '+' : ''}${EURM(v)}`);

  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxV * i) / ticks, y = yOf(v);
    g += `<line x1="${pl}" y1="${y.toFixed(1)}" x2="${W - pr}" y2="${y.toFixed(1)}" stroke="${C.line}"/>`;
    g += `<text x="${pl - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11.5" fill="${C.muted}">${fmtAxis(v)}</text>`;
  }

  const x0 = xOf(contractStartMs), xEnd = xOf(contractEndMs), xToday = xOf(clampedToday);
  let vgrid = '', labs = '';
  const startYear = new Date(contractStartMs).getUTCFullYear();
  const endYear = new Date(contractEndMs).getUTCFullYear();
  const seen = new Set<number>();
  for (let y = startYear; y <= endYear; y++) {
    const tickMs = Math.min(contractEndMs, Math.max(contractStartMs, Date.UTC(y, 0, 1)));
    const x = xOf(tickMs);
    const key = Math.round(x);
    if (seen.has(key)) continue;
    seen.add(key);
    vgrid += `<line x1="${x.toFixed(1)}" y1="${pt}" x2="${x.toFixed(1)}" y2="${pt + ph}" stroke="${C.line}" opacity="0.5"/>`;
    labs += `<text x="${x.toFixed(1)}" y="${H - pb + 18}" text-anchor="middle" font-size="12.5" fill="${C.muted}">${y}</text>`;
  }

  let lines = '';
  if (sharedTheoretical && series.length) {
    lines += `<polyline points="${x0.toFixed(1)},${yOf(0).toFixed(1)} ${xEnd.toFixed(1)},${yOf(series[0].theoreticalEnd).toFixed(1)}" fill="none" stroke="${C.muted}" stroke-width="2" stroke-dasharray="6 4"/>`;
  }

  series.forEach((s, si) => {
    if (!sharedTheoretical) {
      lines += `<polyline points="${x0.toFixed(1)},${yOf(0).toFixed(1)} ${xEnd.toFixed(1)},${yOf(s.theoreticalEnd).toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="6 4" opacity="0.6"/>`;
    }
    if (s.realToday == null) return;
    const yToday = yOf(s.realToday);
    const yProjEnd = yOf(projectedEnd[si] as number);
    lines += `<polyline points="${x0.toFixed(1)},${yOf(0).toFixed(1)} ${xToday.toFixed(1)},${yToday.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="2.6"/>`;
    lines += `<polyline points="${xToday.toFixed(1)},${yToday.toFixed(1)} ${xEnd.toFixed(1)},${yProjEnd.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-dasharray="2 4" opacity="0.85"/>`;
    lines += `<circle cx="${xToday.toFixed(1)}" cy="${yToday.toFixed(1)}" r="5.5" fill="${s.color}" stroke="#fff" stroke-width="2" class="seg" data-tip="${esc(
      `${s.name} · oggi\nErosione reale: ${fmtVal(s.realToday)}\nProiezione a fine contratto al ritmo attuale: ${fmtVal(projectedEnd[si] as number)}\nTarget teorico a fine contratto: ${fmtVal(s.theoreticalEnd)}\nScostamento proiezione vs target: ${fmtDelta((projectedEnd[si] as number) - s.theoreticalEnd)}`,
    )}"/>`;
  });

  const mk = `<line x1="${xToday.toFixed(1)}" y1="${pt}" x2="${xToday.toFixed(1)}" y2="${pt + ph}" stroke="${C.amberD}" stroke-width="1.3" stroke-dasharray="4 3"/><text x="${(xToday + 5).toFixed(1)}" y="${pt + 13}" text-anchor="start" font-size="10" fill="${C.amberD}" font-weight="700">oggi</text>`;

  return `<svg class="msvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}${vgrid}${lines}${mk}${labs}</svg>`;
}

function RTIPanel({
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
  const totRisk = erosionRisk(eroTotPct);
  const residuo = ceil - totImpegnato;
  const fillW = Math.min(100, Math.max(eroTotPct, 2));

  const eroAnnoSvg = buildYearlyErosionChart(years, impByYear, annualQuota, todayYear);
  const eroAnnoHtml = `<div>
    <div class="erohead" style="margin-bottom:12px">
      <div class="erorow"><span>Massimale contrattuale</span><b>${EURM(ceil)} · <span style="color:${totRisk.color}">${totRisk.label}</span></b></div>
      <div class="erotrack"><div class="erofill" style="width:${fillW.toFixed(1)}%;background:${totRisk.color}">${PCT(eroTotPct)}</div></div>
      <div class="eroleg"><span>Impegnato totale <b>${EURM(totImpegnato)}</b></span><span>${
        residuo < 0
          ? `<b style="color:${C.bad}">Sforamento ${EURM(-residuo)}</b>`
          : `Residuo <b>${EURM(residuo)}</b>`
      }</span></div>
    </div>
    ${eroAnnoSvg}
    <div style="font-size:11px;color:var(--muted);margin-top:6px">
      Contratto ${meta.contract_date} → ${meta.valid_to} · Budget annuo stimato ${EURM(annualQuota)} · IF/BO raggruppati per anno di inizio
    </div>
  </div>`;

  // Theoretical linear pace vs real erosion, per partner, over the contract
  // period: 0% on the signing date, 100% (or the quota, in € terms) on the
  // expiry date — both read straight from meta, independent of the annual
  // buckets used by the chart above. The real line starts at 0 on the
  // signing date, passes through today's actual impegnato, and is then
  // projected forward at that same pace to the expiry date.
  const contractStartMs = new Date(meta.contract_date).getTime();
  const contractEndMs = new Date(meta.valid_to).getTime();
  const nowMs = Date.now();
  const contractStarted = nowMs >= contractStartMs;
  const elapsedMs = Math.min(Math.max(nowMs, contractStartMs), contractEndMs) - contractStartMs;
  const totalContractMs = Math.max(1, contractEndMs - contractStartMs);
  const theoreticalTodayPct = Math.min(100, Math.max(0, (elapsedMs / totalContractMs) * 100));
  const projectedFactor = elapsedMs > 0 ? totalContractMs / elapsedMs : 1;

  // Two independent comparisons — mixing them would compare a company's own
  // quota against the whole contract's pace, which is meaningless:
  //  1. the CONTRACT total (ceiling) vs the total real impegnato;
  //  2. each PARTNER's own quota vs that partner's own real impegnato.
  const TOTAL_COLOR = C.ink;
  const totalRealPct = contractStarted ? eroTotPct : null;
  const totalRealEur = contractStarted ? totImpegnato : null;
  const totalProjectedPct = totalRealPct != null ? totalRealPct * projectedFactor : null;
  const totalProjectedEur = totalRealEur != null ? totalRealEur * projectedFactor : null;

  const eroTotalPctSvg = buildErosionProjectionChart(
    contractStartMs,
    contractEndMs,
    nowMs,
    [{ name: 'Totale contratto', color: TOTAL_COLOR, theoreticalEnd: 100, realToday: totalRealPct }],
    'pct',
    false,
  );
  const eroTotalEurSvg = buildErosionProjectionChart(
    contractStartMs,
    contractEndMs,
    nowMs,
    [{ name: 'Totale contratto', color: TOTAL_COLOR, theoreticalEnd: ceil, realToday: totalRealEur }],
    'eur',
    false,
  );

  const totalDeltaHtml = (() => {
    if (totalProjectedPct == null) return '';
    const delta = totalProjectedPct - 100;
    const sign = delta >= 0 ? '+' : '';
    const word = delta >= 0 ? 'supererebbe il massimale a questo ritmo' : 'resterebbe sotto il massimale a questo ritmo';
    return `<div style="max-width:320px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;border-left:3px solid ${TOTAL_COLOR}">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700">Totale contratto · proiezione a fine contratto</div>
      <div style="font-size:19px;font-weight:800;font-family:'SFMono-Regular',monospace;color:${TOTAL_COLOR}">${sign}${delta.toFixed(1)} p.p.</div>
      <div style="font-size:12px;color:var(--muted)">${word}</div>
    </div>`;
  })();

  const eroTotalPctHtml = `<div>
    ${eroTotalPctSvg}
    <div style="display:flex;gap:9px 20px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:14px">${legchips([
      { c: TOTAL_COLOR, t: 'Ritmo teorico lineare (0→100% del massimale)', dash: true },
      { c: TOTAL_COLOR, t: 'Totale contratto · reale', line: true },
    ])}</div>
    ${totalDeltaHtml ? `<div style="margin-top:16px">${totalDeltaHtml}</div>` : ''}
    <div style="font-size:11px;color:var(--muted);margin-top:14px">
      Erosione dell'intero massimale contrattuale, indipendente dalla ripartizione tra le aziende del RTI. Tratto continuo = erosione reale a oggi, tratteggiato = proiezione a fine contratto mantenendo il ritmo attuale.
    </div>
  </div>`;

  const eroTotalEurHtml = `<div>
    ${eroTotalEurSvg}
    <div style="display:flex;gap:9px 20px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:14px">${legchips([
      { c: TOTAL_COLOR, t: 'Massimale · ritmo teorico lineare', dash: true },
      { c: TOTAL_COLOR, t: 'Totale contratto · reale', line: true },
    ])}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:14px">
      Stesso confronto in valore assoluto sull'intero massimale contrattuale.
    </div>
  </div>`;

  const quotaErosion = rti.partners.map((p) => {
    const realEur = contractStarted ? impByP[p.name] || 0 : null;
    const realPct = realEur != null ? (p.quota ? (realEur / p.quota) * 100 : 0) : null;
    const projectedPct = realPct != null ? realPct * projectedFactor : null;
    const projectedEur = realEur != null ? realEur * projectedFactor : null;
    return { name: p.name, color: FCOL[p.name] || C.slateL, quota: p.quota, pct: p.pct, realEur, realPct, projectedPct, projectedEur };
  });

  const eroQuotaPctSvg = buildErosionProjectionChart(
    contractStartMs,
    contractEndMs,
    nowMs,
    quotaErosion.map((s) => ({ name: s.name, color: s.color, theoreticalEnd: 100, realToday: s.realPct })),
    'pct',
    true,
  );
  const eroQuotaEurSvg = buildErosionProjectionChart(
    contractStartMs,
    contractEndMs,
    nowMs,
    quotaErosion.map((s) => ({ name: s.name, color: s.color, theoreticalEnd: s.quota, realToday: s.realEur })),
    'eur',
    false,
  );

  const quotaDeltaHtml = quotaErosion
    .map((s) => {
      if (s.projectedPct == null) return '';
      const delta = s.projectedPct - 100;
      const sign = delta >= 0 ? '+' : '';
      const word = delta >= 0 ? 'supererebbe la propria quota a questo ritmo' : 'resterebbe sotto la propria quota a questo ritmo';
      return `<div style="flex:1;min-width:190px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;border-left:3px solid ${s.color}">
        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700">${esc(s.name)} · proiezione a fine contratto</div>
        <div style="font-size:19px;font-weight:800;font-family:'SFMono-Regular',monospace;color:${s.color}">${sign}${delta.toFixed(1)} p.p.</div>
        <div style="font-size:12px;color:var(--muted)">${word}</div>
      </div>`;
    })
    .join('');

  const eroQuotaPctHtml = `<div>
    ${eroQuotaPctSvg}
    <div style="display:flex;gap:9px 20px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:14px">${legchips(
      [
        { c: C.muted, t: 'Ritmo teorico lineare (0→100% della propria quota)', dash: true },
        ...quotaErosion.map((s) => ({ c: s.color, t: `${s.name} · reale`, line: true })),
      ],
    )}</div>
    ${quotaDeltaHtml ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">${quotaDeltaHtml}</div>` : ''}
    <div style="font-size:11px;color:var(--muted);margin-top:14px">
      Ogni azienda confrontata solo con la propria quota contrattuale, mai con il massimale totale: comparabile anche tra quote di dimensione diversa. Tratto continuo = erosione reale a oggi, tratteggiato = proiezione a fine contratto mantenendo il ritmo attuale.
    </div>
  </div>`;

  const eroQuotaEurHtml = `<div>
    ${eroQuotaEurSvg}
    <div style="display:flex;gap:9px 20px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:14px">${legchips(
      quotaErosion.flatMap((s) => [
        { c: s.color, t: `${s.name} · teorico`, dash: true },
        { c: s.color, t: `${s.name} · reale`, line: true },
      ]),
    )}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:14px">
      Stesso confronto in valore assoluto: tratteggiata sottile = ritmo teorico lineare della propria quota, continua = impegnato reale, tratteggiata spessa = proiezione a fine contratto al ritmo attuale.
    </div>
  </div>`;

  const summaryRows = [
    ...quotaErosion.map((s) => ({
      label: s.name,
      color: s.color,
      quota: s.quota,
      quotaPct: s.pct * 100,
      realEur: s.realEur,
      realPct: s.realPct,
      theoreticalTodayEur: s.quota * (theoreticalTodayPct / 100),
      projectedEur: s.projectedEur,
      projectedPct: s.projectedPct,
    })),
    {
      label: 'Totale contratto',
      color: TOTAL_COLOR,
      quota: ceil,
      quotaPct: 100,
      realEur: totalRealEur,
      realPct: totalRealPct,
      theoreticalTodayEur: ceil * (theoreticalTodayPct / 100),
      projectedEur: totalProjectedEur,
      projectedPct: totalProjectedPct,
    },
  ];

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
          <Html
            ariaLabel={`Grafico a ciambella della composizione del RTI sul massimale ${EURM(rti.ceiling)}. ${rti.partners
              .map((p) => `${p.name} ${PCT(p.pct * 100)} pari a ${EURM(p.quota)}`)
              .join('; ')}.`}
            html={donutHtml}
            onClick={onDonutClick}
          />
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
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3>Erosione della quota per partner RTI</h3>
          <div className="cap">
            Valore impegnato (IF/BO della vista) rispetto alla quota contrattuale di ciascun partner
          </div>
          <div className="hbars-fill" style={{ flex: 1 }}>
            <Html html={eroPartner} style={{ height: '100%', display: 'flex', flexDirection: 'column' }} />
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Erosione per Anno</h3>
        <div className="cap">
          Impegnato (IF/BO della vista) distribuito per anno lungo la durata contrattuale
        </div>
        <Html
          ariaLabel={`Erosione del massimale contrattuale per anno. Massimale ${EURM(ceil)}, impegnato totale ${EURM(totImpegnato)} (${PCT(eroTotPct)}, ${totRisk.label}), ${residuo < 0 ? `sforamento ${EURM(-residuo)}` : `residuo ${EURM(residuo)}`}. Impegnato per anno: ${years.map((y) => `${y} ${EURM(impByYear[y] || 0)}`).join(', ')}.`}
          html={eroAnnoHtml}
        />
      </div>
      <div className="card">
        <h3>Erosione teorica vs reale del massimale (%)</h3>
        <div className="cap">
          Ritmo di erosione lineare atteso dell&apos;intero massimale contrattuale, confrontato con l&apos;erosione reale totale maturata ad oggi — a prescindere da come si ripartisce tra le aziende del RTI
        </div>
        <Html
          ariaLabel={`Erosione teorica lineare vs reale del massimale contrattuale, in percentuale. Reale a oggi ${totalRealPct != null ? PCT(totalRealPct) : 'n/d'} contro un target teorico del 100% a fine contratto.`}
          html={eroTotalPctHtml}
        />
      </div>
      <div className="card">
        <h3>Erosione teorica vs reale del massimale (valore)</h3>
        <div className="cap">
          Stesso confronto in valore assoluto sull&apos;intero massimale contrattuale
        </div>
        <Html
          ariaLabel={`Erosione teorica lineare vs reale del massimale contrattuale, in valore. Reale a oggi ${totalRealEur != null ? EURM(totalRealEur) : 'n/d'} contro un massimale di ${EURM(ceil)}.`}
          html={eroTotalEurHtml}
        />
      </div>
      <div className="card">
        <h3>Erosione teorica vs reale delle quote per azienda (%)</h3>
        <div className="cap">
          Ritmo di erosione lineare atteso della quota di ciascuna azienda rispetto alla propria quota (mai rispetto al massimale totale), confrontato con l&apos;erosione reale maturata ad oggi
        </div>
        <Html
          ariaLabel={`Erosione teorica lineare vs reale delle quote, in percentuale, per azienda. ${quotaErosion
            .map((s) => `${s.name}: reale a oggi ${s.realPct != null ? PCT(s.realPct) : 'n/d'} contro un target teorico del 100% della propria quota a fine contratto`)
            .join('; ')}.`}
          html={eroQuotaPctHtml}
        />
      </div>
      <div className="card">
        <h3>Erosione teorica vs reale delle quote per azienda (valore)</h3>
        <div className="cap">
          Stesso confronto in valore assoluto, per azienda: traiettoria teorica lineare della propria quota contrattuale rispetto al proprio impegnato reale
        </div>
        <Html
          ariaLabel={`Erosione teorica lineare vs reale delle quote, in valore, per azienda. ${quotaErosion
            .map((s) => `${s.name}: reale a oggi ${s.realEur != null ? EURM(s.realEur) : 'n/d'} contro una quota contrattuale di ${EURM(s.quota)}`)
            .join('; ')}.`}
          html={eroQuotaEurHtml}
        />
      </div>
      <div className="card">
        <h3>Riepilogo numerico</h3>
        <div className="cap">
          Tutti i numeri teorici e reali, per azienda e per il totale del contratto, alla data odierna e in proiezione a fine contratto
        </div>
        <div className="tscroll">
          <table className="dtable">
            <thead>
              <tr>
                <th>Azienda</th>
                <th className="num">Quota</th>
                <th className="num">Quota %</th>
                <th className="num">Reale a oggi</th>
                <th className="num">Erosione reale a oggi</th>
                <th className="num">Erosione teorica attesa a oggi</th>
                <th className="num">Scostamento a oggi</th>
                <th className="num">Proiezione fine contratto</th>
                <th className="num">Proiezione fine contratto %</th>
                <th className="num">Scostamento proiezione</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((r) => {
                const deltaToday = r.realPct != null ? r.realPct - theoreticalTodayPct : null;
                const deltaProjected = r.projectedPct != null ? r.projectedPct - 100 : null;
                return (
                  <tr key={r.label}>
                    <td>
                      <span className="dot" style={{ background: r.color, display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 7 }} />
                      {r.label === 'Totale contratto' ? <b>{r.label}</b> : r.label}
                    </td>
                    <td className="num">{EUR0(r.quota)} €</td>
                    <td className="num">{PCT(r.quotaPct)}</td>
                    <td className="num">{r.realEur != null ? `${EUR0(r.realEur)} €` : '—'}</td>
                    <td className="num">{r.realPct != null ? PCT(r.realPct) : '—'}</td>
                    <td className="num">{EUR0(r.theoreticalTodayEur)} € · {PCT(theoreticalTodayPct)}</td>
                    <td className="num" style={{ color: deltaToday == null ? undefined : deltaToday >= 0 ? 'var(--good)' : 'var(--amber-d)' }}>
                      {deltaToday != null ? `${deltaToday >= 0 ? '+' : ''}${deltaToday.toFixed(1)} p.p.` : '—'}
                    </td>
                    <td className="num">{r.projectedEur != null ? `${EUR0(r.projectedEur)} €` : '—'}</td>
                    <td className="num">{r.projectedPct != null ? PCT(r.projectedPct) : '—'}</td>
                    <td className="num" style={{ color: deltaProjected == null ? undefined : deltaProjected >= 0 ? 'var(--bad)' : 'var(--good)' }}>
                      {deltaProjected != null ? `${deltaProjected >= 0 ? '+' : ''}${deltaProjected.toFixed(1)} p.p.` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          Contratto {meta.contract_date} → {meta.valid_to}. &quot;Erosione teorica attesa a oggi&quot; è il ritmo lineare 0→100% calcolato sulle date di stipula e scadenza. &quot;Proiezione fine contratto&quot; estrapola il ritmo reale osservato finora fino alla scadenza.
        </div>
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
  const [err, setErr] = useState('');

  // Always start from the current, persisted values — a previous unsaved
  // edit must not resurface next time the form is reopened.
  const resetFromProps = () => {
    setMass(rti.ceiling);
    setIntPct(Math.round(intq * 100));
    setDelPct(Math.round(delq * 100));
    setErr('');
  };

  if (!open) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button
          className="freset"
          onClick={() => {
            resetFromProps();
            setOpen(true);
          }}
          style={{ borderColor: 'var(--petrol)', color: 'var(--petrol-d)' }}
        >
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
          <input type="number" min={0} value={mass} onChange={(e) => setMass(Number(e.target.value))} />
        </label>
        <label>
          Quota % Intellera
          <input
            type="number"
            min={0}
            max={100}
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
      {err && (
        <div className="form-err" style={{ color: 'var(--bad, #c0392b)', marginTop: 8 }}>
          {err}
        </div>
      )}
      <div className="formbtns">
        <button
          className="addbtn"
          onClick={() => {
            if (!Number.isFinite(mass) || mass < 0) {
              setErr('Il massimale contrattuale deve essere un numero >= 0.');
              return;
            }
            if (!Number.isFinite(intPct) || intPct < 0 || intPct > 100) {
              setErr('La quota % Intellera deve essere compresa tra 0 e 100.');
              return;
            }
            if (!Number.isFinite(delPct) || delPct < 0 || delPct > 100) {
              setErr('La quota % Deloitte (100 − Intellera) deve restare tra 0 e 100.');
              return;
            }
            onUpdate({ massimale_totale: mass, quota_intellera_pct: intPct, quota_deloitte_pct: delPct });
            setOpen(false);
          }}
        >
          Aggiorna
        </button>
        <button
          className="clearbtn"
          onClick={() => {
            resetFromProps();
            setOpen(false);
          }}
        >
          Annulla
        </button>
      </div>
    </div>
  );
}

// Memoized: only the active tab is mounted, but edits elsewhere in the
// Dashboard (toasts, drawer, saving flags) re-render the parent — memo skips
// re-rendering the panel when its own data/props are unchanged.
export default React.memo(RTIPanel);
