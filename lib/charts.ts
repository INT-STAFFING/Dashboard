// SVG/HTML chart builders ported 1:1 from the original static dashboard.
// They return HTML strings rendered via dangerouslySetInnerHTML; interactivity
// (drill-down, tooltips) is wired through event delegation on the container.
import { C, EUR, EUR0 } from './format';

export const esc = (s: unknown) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

export type DonutSeg = {
  label: string;
  v: number;
  c: string;
  tip?: string;
  drillStato?: string;
  drillRti?: string;
};

export function donut(segs: DonutSeg[], big: string | number, small: string): string {
  const tot = segs.reduce((s, x) => s + x.v, 0);
  const R = 70,
    SW = 42,
    cx = 115,
    cy = 115,
    Circ = 2 * Math.PI * R,
    gap = tot > 0 ? Math.min(2.2, Circ * 0.004) : 0;
  let arcs = '',
    acc = 0;
  if (tot > 0) {
    segs.forEach((s) => {
      const f = s.v / tot;
      if (f <= 0) return;
      const len = Math.max(0.5, f * Circ - gap),
        off = -acc * Circ - gap / 2;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${s.c}" stroke-width="${SW}" stroke-linecap="butt" stroke-dasharray="${len.toFixed(
        2,
      )} ${(Circ - len).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" data-tip="${esc(
        s.tip || s.label,
      )}"${s.drillStato ? ` data-drill-stato="${esc(s.drillStato)}"` : ''}${
        s.drillRti ? ` data-drill-rti="${esc(s.drillRti)}"` : ''
      } class="seg"/>`;
      acc += f;
    });
  } else
    arcs = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.line}" stroke-width="${SW}"/>`;
  const center =
    big !== '' && big != null
      ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="30" font-weight="800" fill="${C.ink}">${esc(
          big,
        )}</text><text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="11.5" fill="${C.muted}">${esc(
          small,
        )}</text>`
      : '';
  const chips = segs
    .map(
      (s) =>
        `<span class="chip"><span class="dot" style="background:${s.c}"></span>${esc(s.label)}</span>`,
    )
    .join('');
  return `<div class="donutwrap"><svg viewBox="0 0 230 230" class="donutsvg"><g transform="rotate(-90 ${cx} ${cy})">${arcs}</g>${center}</svg><div class="chips">${chips}</div></div>`;
}

export type HBarRow = {
  label: string;
  v: number;
  disp: string;
  sub?: string;
  c?: string;
  tip?: string;
};

export function hbars(rows: HBarRow[], color?: string, opts?: { max?: number }): string {
  opts = opts || {};
  const max = opts.max || Math.max(1, ...rows.map((r) => r.v));
  return (
    `<div class="hbars">` +
    rows
      .map((r) => {
        const col = r.c || color || C.petrolL;
        return `<div class="hrow" data-tip="${esc(r.tip || r.label)}"><div class="hl" title="${esc(
          r.label,
        )}">${esc(r.label)}</div><div class="htrack"><div class="hfill" style="width:${Math.min(
          100,
          (r.v / max) * 100,
        ).toFixed(1)}%;background:${col}"></div></div><div class="hval">${esc(r.disp)}${
          r.sub ? `<span class="hsub">${esc(r.sub)}</span>` : ''
        }</div></div>`;
      })
      .join('') +
    `</div>`
  );
}

export type StackRow = {
  label: string;
  total: number;
  disp: string;
  sub?: string;
  segs: { v: number; c: string }[];
  tip: string;
};

export function hbarsStacked(rows: StackRow[], opts?: { max?: number }): string {
  opts = opts || {};
  const max = opts.max || Math.max(1, ...rows.map((r) => r.total));
  return (
    `<div class="hbars">` +
    rows
      .map((r) => {
        const segs = r.segs
          .filter((s) => s.v > 0)
          .map(
            (s) =>
              `<div class="hsseg" style="width:${((s.v / max) * 100).toFixed(2)}%;background:${s.c}"></div>`,
          )
          .join('');
        return `<div class="hsrow" data-tip="${esc(r.tip)}"><div class="hl" title="${esc(
          r.label,
        )}">${esc(r.label)}</div><div class="hstrack">${segs}</div><div class="hval">${esc(r.disp)}${
          r.sub ? `<span class="hsub">${esc(r.sub)}</span>` : ''
        }</div></div>`;
      })
      .join('') +
    `</div>`
  );
}

export type Series = { name: string; vals: number[]; color: string };
export type MonthlyOpts = {
  cumulative?: { vals: number[]; color: string; name: string };
  today?: number;
};

export function chartMonthly(months: string[], series: Series[], opts?: MonthlyOpts): string {
  opts = opts || {};
  const W = 920,
    H = 360,
    pl = 86,
    pr = opts.cumulative ? 64 : 18,
    pt = 20,
    pb = 44;
  const pw = W - pl - pr,
    ph = H - pt - pb;
  const allBar = series.flatMap((s) => s.vals);
  const maxV = Math.max(1, ...allBar);
  const ticks = 4;
  const yOf = (v: number) => pt + ph - (v / maxV) * ph;
  const slot = pw / months.length;
  const ns = series.length;
  const gw = slot * 0.62;
  const bw = gw / ns;
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxV * i) / ticks,
      y = yOf(v);
    g += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="${C.line}"/><text x="${
      pl - 8
    }" y="${y + 4}" text-anchor="end" font-size="11.5" fill="${C.muted}">€${EUR0(v)}</text>`;
  }
  let bars = '',
    labs = '';
  months.forEach((mn, i) => {
    const cx = pl + slot * i + slot / 2;
    series.forEach((s, si) => {
      const x = cx - gw / 2 + si * bw;
      const y = yOf(s.vals[i]);
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 2).toFixed(
        1,
      )}" height="${(pt + ph - y).toFixed(1)}" rx="3" fill="${s.color}" class="seg" data-tip="${esc(
        mn + ' 2026 · ' + s.name + '\n' + EUR(s.vals[i]),
      )}"/>`;
    });
    labs += `<text x="${cx.toFixed(1)}" y="${H - pb + 18}" text-anchor="middle" font-size="11" fill="${
      C.muted
    }">${esc(mn)}</text>`;
  });
  let cum = '';
  if (opts.cumulative) {
    const cv = opts.cumulative.vals;
    const cmax = Math.max(1, ...cv);
    const yC = (v: number) => pt + ph - (v / cmax) * ph;
    for (let i = 0; i <= ticks; i++) {
      const v = (cmax * i) / ticks,
        y = yC(v);
      cum += `<text x="${W - pr + 8}" y="${y + 4}" text-anchor="start" font-size="10.5" fill="${
        opts.cumulative.color
      }">€${EUR0(v)}</text>`;
    }
    const pts = months.map((m, i) => `${(pl + slot * i + slot / 2).toFixed(1)},${yC(cv[i]).toFixed(1)}`).join(' ');
    cum += `<polyline points="${pts}" fill="none" stroke="${opts.cumulative.color}" stroke-width="2.6"/>`;
    months.forEach((m, i) => {
      cum += `<circle cx="${(pl + slot * i + slot / 2).toFixed(1)}" cy="${yC(cv[i]).toFixed(
        1,
      )}" r="4.5" fill="${opts.cumulative!.color}" class="seg" data-tip="${esc(
        m + ' 2026 · ' + opts!.cumulative!.name + '\n' + EUR(cv[i]),
      )}"/>`;
    });
  }
  let mk = '';
  if (opts.today != null && opts.today >= 0 && opts.today < months.length) {
    const mx = pl + slot * (opts.today + 1);
    mk = `<line x1="${mx}" y1="${pt}" x2="${mx}" y2="${pt + ph}" stroke="${C.amberD}" stroke-width="1.3" stroke-dasharray="4 3"/><text x="${
      mx - 4
    }" y="${pt + 11}" text-anchor="end" font-size="10" fill="${C.amberD}" font-weight="700">oggi</text>`;
  }
  return `<svg class="msvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}${bars}${cum}${mk}${labs}</svg>`;
}

export type LegItem = { c: string; t: string; line?: boolean; dash?: boolean };
export function legchips(items: LegItem[]): string {
  return items
    .map(
      (i) =>
        `<span class="chip"><span class="dot" style="background:${i.c};${
          i.line ? 'width:14px;height:3px;border-radius:2px;' : ''
        }${i.dash ? 'width:14px;height:0;border-top:2px dashed ' + i.c + ';background:none;' : ''}"></span>${esc(
          i.t,
        )}</span>`,
    )
    .join('');
}

export type VBarItem = {
  label: string;
  val: number;
  color: string;
  tip: string;
  drill?: string;
};
export function chartVBars(items: VBarItem[]): string {
  const W = 900,
    H = 320,
    pl = 58,
    pr = 18,
    pt = 18,
    pb = 42;
  const pw = W - pl - pr,
    ph = H - pt - pb;
  const maxV = Math.max(1, ...items.map((i) => i.val));
  const ticks = 4;
  const yOf = (v: number) => pt + ph - (v / maxV) * ph;
  const slot = pw / items.length;
  const bw = Math.min(170, slot * 0.5);
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxV * i) / ticks,
      y = yOf(v);
    g += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="${C.line}"/><text x="${
      pl - 8
    }" y="${y + 4}" text-anchor="end" font-size="11.5" fill="${C.muted}">${EUR0(v)}</text>`;
  }
  let bars = '',
    labs = '';
  items.forEach((it, i) => {
    const cx = pl + slot * i + slot / 2;
    const y = yOf(it.val);
    bars += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(
      1,
    )}" height="${(pt + ph - y).toFixed(1)}" rx="5" fill="${it.color}" class="seg" data-tip="${esc(
      it.tip,
    )}"${it.drill ? ` data-drill-mod="${esc(it.drill)}" style="cursor:pointer"` : ''}/>`;
    bars += `<text x="${cx.toFixed(1)}" y="${(y - 7).toFixed(
      1,
    )}" text-anchor="middle" font-size="13" font-weight="700" fill="${C.ink}">${it.val}</text>`;
    labs += `<text x="${cx.toFixed(1)}" y="${H - pb + 19}" text-anchor="middle" font-size="12.5" fill="${
      C.muted
    }">${esc(it.label)}</text>`;
  });
  return `<svg class="msvg" viewBox="0 0 ${W} ${H}">${g}${bars}${labs}</svg>`;
}

export function chartRevFatt(labels: string[], rev: number[], fatt: number[], todayIdx: number): string {
  const W = 1000,
    H = 420,
    pl = 74,
    pr = 66,
    pt = 22,
    pb = 42;
  const pw = W - pl - pr,
    ph = H - pt - pb;
  const maxBar = Math.max(1, ...rev, ...fatt);
  const ticks = 4;
  const yL = (v: number) => pt + ph - (v / maxBar) * ph;
  let cr = 0,
    cf = 0;
  const cumR = rev.map((v) => (cr += v)),
    cumF = fatt.map((v) => (cf += v));
  const maxCum = Math.max(1, cumR[cumR.length - 1], cumF[cumF.length - 1]);
  const yR = (v: number) => pt + ph - (v / maxCum) * ph;
  const slot = pw / labels.length;
  const gw = slot * 0.56;
  const bw = gw / 2;
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxBar * i) / ticks,
      y = yL(v);
    g += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="${C.line}"/><text x="${
      pl - 8
    }" y="${y + 4}" text-anchor="end" font-size="11.5" fill="${C.muted}">€${EUR0(v / 1000)}k</text>`;
    const vc = (maxCum * i) / ticks;
    g += `<text x="${W - pr + 8}" y="${yR(vc) + 4}" text-anchor="start" font-size="11" fill="${
      C.muted
    }">${(vc / 1e6).toFixed(1)}M</text>`;
  }
  let bars = '',
    labs = '';
  labels.forEach((mn, i) => {
    const cx = pl + slot * i + slot / 2;
    const xr = cx - gw / 2,
      xf = cx - gw / 2 + bw;
    bars += `<rect x="${xr.toFixed(1)}" y="${yL(rev[i]).toFixed(1)}" width="${(bw - 2).toFixed(
      1,
    )}" height="${(pt + ph - yL(rev[i])).toFixed(1)}" rx="3" fill="${C.petrol}"/>`;
    bars += `<rect x="${xf.toFixed(1)}" y="${yL(fatt[i]).toFixed(1)}" width="${(bw - 2).toFixed(
      1,
    )}" height="${(pt + ph - yL(fatt[i])).toFixed(1)}" rx="3" fill="${C.gold}"/>`;
    labs += `<text x="${cx.toFixed(1)}" y="${H - pb + 18}" text-anchor="middle" font-size="11.5" fill="${
      C.muted
    }">${esc(mn)}</text>`;
  });
  const ptsR = labels.map((m, i) => `${(pl + slot * i + slot / 2).toFixed(1)},${yR(cumR[i]).toFixed(1)}`).join(' ');
  const ptsF = labels.map((m, i) => `${(pl + slot * i + slot / 2).toFixed(1)},${yR(cumF[i]).toFixed(1)}`).join(' ');
  let lines = `<polyline points="${ptsR}" fill="none" stroke="${C.petrolD}" stroke-width="2.6"/><polyline points="${ptsF}" fill="none" stroke="${C.amberD}" stroke-width="2.4" stroke-dasharray="6 4"/>`;
  labels.forEach((m, i) => {
    const cx = pl + slot * i + slot / 2;
    lines += `<circle cx="${cx.toFixed(1)}" cy="${yR(cumR[i]).toFixed(
      1,
    )}" r="4" fill="#fff" stroke="${C.petrolD}" stroke-width="2"/>`;
    lines += `<circle cx="${cx.toFixed(1)}" cy="${yR(cumF[i]).toFixed(
      1,
    )}" r="3.5" fill="#fff" stroke="${C.amberD}" stroke-width="2"/>`;
  });
  let mk = '';
  if (todayIdx >= 0 && todayIdx < labels.length) {
    const mx = pl + slot * (todayIdx + 1);
    mk = `<line x1="${mx}" y1="${pt}" x2="${mx}" y2="${pt + ph}" stroke="${C.amberD}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".7"/><text x="${
      mx - 4
    }" y="${pt + 11}" text-anchor="end" font-size="10" fill="${C.amberD}" font-weight="700">oggi</text>`;
  }
  let hov = '';
  labels.forEach((mn, i) => {
    const x = pl + slot * i;
    const tipTxt = `${mn} 2026\nRevenue: ${EUR(rev[i])}\nFatturazione: ${EUR(fatt[i])}\nCum. Revenue: ${EUR(
      cumR[i],
    )}\nCum. Fatturazione: ${EUR(cumF[i])}`;
    hov += `<rect x="${x.toFixed(1)}" y="${pt}" width="${slot.toFixed(
      1,
    )}" height="${ph}" fill="transparent" style="pointer-events:all" class="hovcol" data-tip="${esc(tipTxt)}"/>`;
  });
  return `<svg class="msvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}${bars}${lines}${mk}${labs}${hov}</svg>`;
}
