'use client';
import React, { useState } from 'react';
import type { Intervento, RtiConfig } from '@/lib/types';
import { EUR, EURM, PCT, FCOL, C } from '@/lib/format';
import { donut, hbars } from '@/lib/charts';
import { Html } from '../Html';

export default function RTIPanel({
  IFs,
  rti,
  quotaVal,
  filtersForn,
  rtiSel,
  setRtiSel,
  editMode,
  onUpdateRti,
}: {
  IFs: Intervento[];
  rti: RtiConfig;
  quotaVal: Record<string, number>;
  filtersForn?: string;
  rtiSel: string | null;
  setRtiSel: (v: string | null) => void;
  editMode: boolean;
  onUpdateRti: (u: { massimale_totale: number; quota_intellera_pct: number; quota_deloitte_pct: number }) => void;
}) {
  const tot = IFs.reduce((s, i) => s + i.importo, 0);
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

  const eDen = selP ? quotaVal[selP] : ceil;
  const impB = selP ? impByP[selP] || 0 : tot;
  const ePct = eDen ? (impB / eDen) * 100 : 0;
  const selPartner = selP ? rti.partners.find((p) => p.name === selP) : null;

  const eroHead = `<div class="erohead">
    <div class="erorow"><span>${selP ? 'Quota ' + selP : 'Massimale contrattuale'}</span><b>${EURM(eDen)}</b></div>
    <div class="erotrack"><div class="erofill" style="width:${Math.max(ePct, 6).toFixed(1)}%">${PCT(ePct)}</div></div>
    <div class="eroleg"><span>Impegnato (IF/BO) <b>${EURM(impB)}</b></span><span>Residuo <b>${EURM(eDen - impB)}</b></span></div>
    <div class="eronote">${
      selP && selPartner
        ? 'Quota ' + selP + ' = ' + PCT(selPartner.pct * 100) + ' del massimale ' + EURM(ceil) + '.'
        : 'Revenue contratto 2026: <b>' + EURM(rti.erosione_2026) + '</b>.'
    }</div></div>`;

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
          <h3>Erosione del massimale</h3>
          <div className="cap">
            {selP ? `Impegnato ${selP} rispetto alla sua quota RTI` : 'Impegnato tramite IF/BO rispetto al massimale'}
          </div>
          <Html html={eroHead} />
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
