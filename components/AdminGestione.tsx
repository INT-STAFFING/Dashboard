'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  Intervento,
  Meta,
  RtiConfig,
  Timeline,
  Seniority,
  IfRisorsa,
  BefRow,
} from '@/lib/types';
import { aggregate, type Calendar, type Grain } from '@/lib/fiscal';
import { MESI, EUR } from '@/lib/format';
import './admin-gestione.css';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const n = (v: unknown): number => Number(v) || 0;
const v12 = (a?: number[] | null): number[] => {
  const out = Array(12).fill(0) as number[];
  if (Array.isArray(a)) for (let i = 0; i < 12; i++) out[i] = n(a[i]);
  return out;
};

function useToast() {
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const show = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad });
    setTimeout(() => setToast(null), 2600);
  }, []);
  return { toast, show };
}

// Labelled numeric input
function NumInput({
  value,
  onChange,
  step = 0.01,
  width = 120,
}: {
  value: number | null;
  onChange: (v: number) => void;
  step?: number;
  width?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value == null ? '' : value}
      onChange={(e) => onChange(n(e.target.value))}
      style={{
        width,
        fontFamily: 'inherit',
        fontSize: 13,
        border: '1px solid var(--line)',
        borderRadius: 7,
        padding: '6px 8px',
        background: '#fff',
        textAlign: 'right',
      }}
    />
  );
}

function TextInput({
  value,
  onChange,
  width,
  placeholder,
}: {
  value: string | null;
  onChange: (v: string) => void;
  width?: number | string;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: width ?? '100%',
        fontFamily: 'inherit',
        fontSize: 13,
        border: '1px solid var(--line)',
        borderRadius: 7,
        padding: '6px 8px',
        background: '#fff',
      }}
    />
  );
}

// 12-month editable grid (always calendar order Gen..Dic = source of truth)
function MonthGrid({
  values,
  onChange,
}: {
  values: number[];
  onChange: (vals: number[]) => void;
}) {
  return (
    <div className="monthgrid">
      {MESI.map((m, i) => (
        <label key={i} className="mg-cell">
          <span className="mg-lab">{m}</span>
          <input
            type="number"
            step={0.01}
            value={values[i] ?? 0}
            onChange={(e) => {
              const next = values.slice();
              next[i] = n(e.target.value);
              onChange(next);
            }}
          />
        </label>
      ))}
    </div>
  );
}

// Read-only rollups for a 12-month series, with calendar + grain toggles.
function Rollups({ values }: { values: number[] }) {
  const [cal, setCal] = useState<Calendar>('solare');
  const [grain, setGrain] = useState<Grain>('trimestrale');
  const buckets = useMemo(() => aggregate(values, cal, grain), [values, cal, grain]);
  const tot = buckets.reduce((s, b) => s + b.value, 0);
  return (
    <div className="rollup">
      <div className="rollbar">
        <div className="seg2 small">
          <button className={cal === 'solare' ? 'on' : ''} onClick={() => setCal('solare')}>
            Anno solare
          </button>
          <button className={cal === 'fiscale' ? 'on' : ''} onClick={() => setCal('fiscale')}>
            Anno fiscale (Set–Ago)
          </button>
        </div>
        <div className="seg2 small">
          {(['mensile', 'trimestrale', 'annuale'] as Grain[]).map((gr) => (
            <button key={gr} className={grain === gr ? 'on' : ''} onClick={() => setGrain(gr)}>
              {gr[0].toUpperCase() + gr.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="rollgrid">
        {buckets.map((b, i) => (
          <div key={i} className="rollcell">
            <div className="rc-lab">{b.label}</div>
            <div className="rc-val">{EUR(b.value)}</div>
          </div>
        ))}
        <div className="rollcell tot">
          <div className="rc-lab">Totale</div>
          <div className="rc-val">{EUR(tot)}</div>
        </div>
      </div>
    </div>
  );
}

const SECTIONS = ['Valori di gara', 'Revenue & Consuntivazione', 'IF / BO'] as const;
type Section = (typeof SECTIONS)[number];

export default function AdminGestione({
  meta: meta0,
  rti: rti0,
  timeline: tl0,
  seniority: sen0,
  interventi: ifs0,
}: {
  meta: Meta;
  rti: RtiConfig;
  timeline: Timeline;
  seniority: Seniority[];
  interventi: Intervento[];
}) {
  const [section, setSection] = useState<Section>('Valori di gara');
  const { toast, show } = useToast();

  return (
    <>
      <header>
        <div className="wrap brandrow">
          <div>
            <div className="eyebrow">Pannello amministrazione · Intellera</div>
            <h1>Gestione dati · ARIA SISS L2</h1>
          </div>
          <div className="hdr-right">
            <Link href="/dashboard" className="hdr-link">
              ← Torna alla Dashboard
            </Link>
          </div>
        </div>
      </header>

      <nav className="tabbar">
        <div className="wrap" id="tabs">
          {SECTIONS.map((s, i) => (
            <button
              key={s}
              className={'tab' + (s === section ? ' on' : '')}
              onClick={() => setSection(s)}
            >
              <span className="ti">{i + 1}</span>
              {s}
            </button>
          ))}
        </div>
      </nav>

      <main className="wrap" style={{ paddingTop: 22, paddingBottom: 60 }}>
        {section === 'Valori di gara' && <GaraSection meta0={meta0} rti0={rti0} sen0={sen0} show={show} />}
        {section === 'Revenue & Consuntivazione' && <GlobalRevSection tl0={tl0} show={show} />}
        {section === 'IF / BO' && <IfBoSection ifs0={ifs0} show={show} />}
      </main>

      {toast && <div className={'toast' + (toast.bad ? ' bad' : '')}>{toast.msg}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Valori di gara (meta + RTI + figure professionali/tariffe globali)
// ---------------------------------------------------------------------------
function GaraSection({
  meta0,
  rti0,
  sen0,
  show,
}: {
  meta0: Meta;
  rti0: RtiConfig;
  sen0: Seniority[];
  show: (m: string, bad?: boolean) => void;
}) {
  const [meta, setMeta] = useState<Meta>(meta0);
  const [ceiling, setCeiling] = useState<number>(rti0.ceiling);
  const [partners, setPartners] = useState(rti0.partners.map((p) => ({ name: p.name, pct: p.pct })));
  const [sen, setSen] = useState<Seniority[]>(sen0);
  const [busy, setBusy] = useState(false);

  const pctTot = partners.reduce((s, p) => s + p.pct, 0) * 100;

  const saveGara = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/gara', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta,
          rti: { massimale_totale: ceiling, partners },
        }),
      });
      if (!res.ok) throw new Error();
      show('Valori di gara salvati');
    } catch {
      show('Salvataggio non riuscito', true);
    } finally {
      setBusy(false);
    }
  };

  const saveTariffe = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tariffe', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seniority: sen }),
      });
      if (!res.ok) throw new Error();
      show('Figure professionali salvate');
    } catch {
      show('Salvataggio non riuscito', true);
    } finally {
      setBusy(false);
    }
  };

  const setMetaField = (k: keyof Meta, v: string | number) => setMeta((m) => ({ ...m, [k]: v }));

  return (
    <>
      <div className="card">
        <h3>Dati contrattuali / di gara</h3>
        <div className="cap">Metadati del contratto SISS L2 mostrati in dashboard.</div>
        <div className="formgrid cols2">
          <Field label="CIG">
            <TextInput value={meta.cig} onChange={(v) => setMetaField('cig', v)} />
          </Field>
          <Field label="Contratto">
            <TextInput value={meta.contratto} onChange={(v) => setMetaField('contratto', v)} />
          </Field>
          <Field label="ODA/G">
            <TextInput value={meta.odag} onChange={(v) => setMetaField('odag', v)} />
          </Field>
          <Field label="Durata (mesi)">
            <NumInput value={meta.months} step={1} onChange={(v) => setMetaField('months', v)} />
          </Field>
          <Field label="Data contratto">
            <TextInput value={meta.contract_date} onChange={(v) => setMetaField('contract_date', v)} placeholder="AAAA-MM-GG" />
          </Field>
          <Field label="Valido fino al">
            <TextInput value={meta.valid_to} onChange={(v) => setMetaField('valid_to', v)} placeholder="AAAA-MM-GG" />
          </Field>
        </div>
      </div>

      <div className="card">
        <h3>Massimale e quote RTI</h3>
        <div className="cap">
          Massimale contrattuale e ripartizione per partner. Le quote in € si ricalcolano dalla
          percentuale. Somma percentuali: <b style={{ color: Math.abs(pctTot - 100) > 0.1 ? 'var(--bad)' : 'var(--good)' }}>{pctTot.toFixed(1)}%</b>
        </div>
        <Field label="Massimale totale (€)">
          <NumInput value={ceiling} width={200} onChange={setCeiling} />
        </Field>
        <table className="datatable" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Partner</th>
              <th style={{ textAlign: 'right' }}>Quota %</th>
              <th style={{ textAlign: 'right' }}>Quota €</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p, i) => (
              <tr key={i}>
                <td>
                  <TextInput
                    value={p.name}
                    onChange={(v) =>
                      setPartners((ps) => ps.map((x, j) => (j === i ? { ...x, name: v } : x)))
                    }
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <NumInput
                    value={Number((p.pct * 100).toFixed(4))}
                    width={90}
                    onChange={(v) =>
                      setPartners((ps) => ps.map((x, j) => (j === i ? { ...x, pct: v / 100 } : x)))
                    }
                  />
                </td>
                <td style={{ textAlign: 'right' }}>{EUR(ceiling * p.pct)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="ubtn bad"
                    onClick={() => setPartners((ps) => ps.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="ubtn"
          style={{ marginTop: 10 }}
          onClick={() => setPartners((ps) => [...ps, { name: 'Nuovo partner', pct: 0 }])}
        >
          + Aggiungi partner
        </button>
        <div style={{ marginTop: 16 }}>
          <button className="exp-save" disabled={busy} onClick={saveGara}>
            💾 Salva valori di gara
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Figure professionali e tariffe</h3>
        <div className="cap">Listino figure (giorni uomo a portafoglio e tariffa giornaliera).</div>
        <table className="datatable">
          <thead>
            <tr>
              <th>Figura</th>
              <th>Sigla</th>
              <th style={{ textAlign: 'right' }}>Giorni uomo</th>
              <th style={{ textAlign: 'right' }}>Tariffa gg (€)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sen.map((s, i) => (
              <tr key={i}>
                <td>
                  <TextInput value={s.figura} onChange={(v) => setSen((l) => l.map((x, j) => (j === i ? { ...x, figura: v } : x)))} />
                </td>
                <td>
                  <TextInput value={s.code} width={140} onChange={(v) => setSen((l) => l.map((x, j) => (j === i ? { ...x, code: v } : x)))} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <NumInput value={s.gg} step={1} width={90} onChange={(v) => setSen((l) => l.map((x, j) => (j === i ? { ...x, gg: v } : x)))} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <NumInput value={s.tariffa} width={110} onChange={(v) => setSen((l) => l.map((x, j) => (j === i ? { ...x, tariffa: v } : x)))} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="ubtn bad" onClick={() => setSen((l) => l.filter((_, j) => j !== i))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="ubtn"
          style={{ marginTop: 10 }}
          onClick={() => setSen((l) => [...l, { figura: 'Nuova figura', code: '', gg: 0, tariffa: 0 }])}
        >
          + Aggiungi figura
        </button>
        <div style={{ marginTop: 16 }}>
          <button className="exp-save" disabled={busy} onClick={saveTariffe}>
            💾 Salva figure professionali
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="adm-field">
      <span className="adm-flab">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// 2. Revenue & Consuntivazione globali (timeline)
// ---------------------------------------------------------------------------
function GlobalRevSection({
  tl0,
  show,
}: {
  tl0: Timeline;
  show: (m: string, bad?: boolean) => void;
}) {
  const [rev, setRev] = useState<number[]>(v12(tl0.revenue_2026));
  const [cons, setCons] = useState<number[]>(v12(tl0.consuntivazione_2026));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/timeline', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revenue_2026: rev, consuntivazione_2026: cons }),
      });
      if (!res.ok) throw new Error();
      show('Revenue e consuntivazione salvate');
    } catch {
      show('Salvataggio non riuscito', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h3>Revenue mensile (globale)</h3>
        <div className="cap">Valori per mese in ordine solare (Gen–Dic). I riepiloghi sotto mostrano anno solare e fiscale.</div>
        <MonthGrid values={rev} onChange={setRev} />
        <Rollups values={rev} />
      </div>

      <div className="card">
        <h3>Consuntivazione mensile (globale)</h3>
        <div className="cap">Valori consuntivati per mese (Gen–Dic).</div>
        <MonthGrid values={cons} onChange={setCons} />
        <Rollups values={cons} />
      </div>

      <div style={{ marginTop: 4 }}>
        <button className="exp-save" disabled={busy} onClick={save}>
          💾 Salva revenue e consuntivazione
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. IF / BO (master-detail)
// ---------------------------------------------------------------------------
function IfBoSection({
  ifs0,
  show,
}: {
  ifs0: Intervento[];
  show: (m: string, bad?: boolean) => void;
}) {
  const [ifs, setIfs] = useState<Intervento[]>(ifs0);
  const [selId, setSelId] = useState<string | null>(ifs0[0]?.numero_if ?? null);
  const [cal, setCal] = useState<Calendar>('solare');

  const sel = ifs.find((i) => i.numero_if === selId) || null;

  const onUpdated = (u: Intervento) =>
    setIfs((list) => list.map((i) => (i.numero_if === u.numero_if ? u : i)));

  // per-IF annual rollups for the summary table
  const annual = (arr: number[] | null | undefined) =>
    aggregate(arr, cal, 'annuale')[0]?.value ?? 0;

  return (
    <>
      <div className="card">
        <h3>Revenue e consuntivazione per IF / BO</h3>
        <div className="cap">Totali annuali per intervento. Seleziona un IF per modificarne il dettaglio.</div>
        <div className="seg2 small" style={{ marginBottom: 12 }}>
          <button className={cal === 'solare' ? 'on' : ''} onClick={() => setCal('solare')}>Anno solare</button>
          <button className={cal === 'fiscale' ? 'on' : ''} onClick={() => setCal('fiscale')}>Anno fiscale (Set–Ago)</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="datatable">
            <thead>
              <tr>
                <th>IF</th>
                <th>Titolo</th>
                <th>Fornitore</th>
                <th>BO</th>
                <th style={{ textAlign: 'right' }}>Revenue {cal === 'fiscale' ? 'fisc.' : 'sol.'}</th>
                <th style={{ textAlign: 'right' }}>Consuntiv.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ifs.map((i) => (
                <tr key={i.numero_if} className={i.numero_if === selId ? 'selrow' : ''}>
                  <td className="mono">{i.numero_if}</td>
                  <td title={i.titolo}>{i.titolo.length > 42 ? i.titolo.slice(0, 41) + '…' : i.titolo}</td>
                  <td>{i.fornitore}</td>
                  <td>{i.has_bo ? '✔' : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{EUR(annual(i.rev_mesi))}</td>
                  <td style={{ textAlign: 'right' }}>{EUR(annual(i.cons_mesi))}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="ubtn" onClick={() => setSelId(i.numero_if)}>
                      Modifica
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sel && <IfDetail key={sel.numero_if} iv={sel} onUpdated={onUpdated} show={show} />}
    </>
  );
}

function IfDetail({
  iv,
  onUpdated,
  show,
}: {
  iv: Intervento;
  onUpdated: (u: Intervento) => void;
  show: (m: string, bad?: boolean) => void;
}) {
  const [core, setCore] = useState({
    titolo: iv.titolo,
    bdo: iv.bdo,
    fornitore: iv.fornitore,
    ambito: iv.ambito,
    importo: iv.importo,
    stato: iv.stato,
    has_bo: iv.has_bo,
    modalita_if: iv.modalita_if,
  });
  const [rev, setRev] = useState<number[]>(v12(iv.rev_mesi));
  const [cons, setCons] = useState<number[]>(v12(iv.cons_mesi));
  const [busy, setBusy] = useState(false);

  const saveCore = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/interventi/${encodeURIComponent(iv.numero_if)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...core, rev_mesi: rev, cons_mesi: cons }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onUpdated(data.updated as Intervento);
      show(`IF ${iv.numero_if} salvato`);
    } catch {
      show('Salvataggio non riuscito', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h3>
          Dettaglio IF <span className="mono">{iv.numero_if}</span>
          {iv.bdo && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · BO {iv.bdo}</span>}
        </h3>
        <div className="cap">Dati anagrafici dell&apos;intervento.</div>
        <div className="formgrid cols2">
          <Field label="Titolo">
            <TextInput value={core.titolo} onChange={(v) => setCore((c) => ({ ...c, titolo: v }))} />
          </Field>
          <Field label="Numero BO">
            <TextInput value={core.bdo} onChange={(v) => setCore((c) => ({ ...c, bdo: v }))} />
          </Field>
          <Field label="Fornitore">
            <TextInput value={core.fornitore} onChange={(v) => setCore((c) => ({ ...c, fornitore: v }))} />
          </Field>
          <Field label="Ambito">
            <TextInput value={core.ambito} onChange={(v) => setCore((c) => ({ ...c, ambito: v }))} />
          </Field>
          <Field label="Importo (€)">
            <NumInput value={core.importo} width={180} onChange={(v) => setCore((c) => ({ ...c, importo: v }))} />
          </Field>
          <Field label="Modalità">
            <TextInput value={core.modalita_if} onChange={(v) => setCore((c) => ({ ...c, modalita_if: v }))} />
          </Field>
          <Field label="Stato">
            <select
              value={core.stato}
              onChange={(e) => setCore((c) => ({ ...c, stato: e.target.value }))}
              style={{ fontFamily: 'inherit', fontSize: 13, border: '1px solid var(--line)', borderRadius: 7, padding: '6px 8px', background: '#fff' }}
            >
              <option value="approvato">approvato</option>
              <option value="non elaborato">non elaborato</option>
            </select>
          </Field>
          <Field label="BO emesso">
            <label className="chk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={core.has_bo} onChange={(e) => setCore((c) => ({ ...c, has_bo: e.target.checked }))} />
              Backoffice emesso
            </label>
          </Field>
        </div>
      </div>

      <div className="card">
        <h3>Revenue mensile · IF {iv.numero_if}</h3>
        <MonthGrid values={rev} onChange={setRev} />
        <Rollups values={rev} />
      </div>

      <div className="card">
        <h3>Consuntivazione mensile · IF {iv.numero_if}</h3>
        <MonthGrid values={cons} onChange={setCons} />
        <Rollups values={cons} />
      </div>

      <div style={{ margin: '4px 0 8px' }}>
        <button className="exp-save" disabled={busy} onClick={saveCore}>
          💾 Salva dati, revenue e consuntivazione IF
        </button>
      </div>

      <RisorseEditor numeroIf={iv.numero_if} show={show} />
      <BefEditor numeroIf={iv.numero_if} show={show} />
    </>
  );
}

// --- Risorse (giorni uomo / figure / gruppi / tariffe per IF) --------------
function RisorseEditor({ numeroIf, show }: { numeroIf: string; show: (m: string, bad?: boolean) => void }) {
  const [rows, setRows] = useState<IfRisorsa[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/risorse/${encodeURIComponent(numeroIf)}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setRows(d.risorse || []);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      active = false;
    };
  }, [numeroIf]);

  const upd = (i: number, patch: Partial<IfRisorsa>) =>
    setRows((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/risorse/${encodeURIComponent(numeroIf)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risorse: rows }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setRows(d.risorse || []);
      show('Risorse salvate');
    } catch {
      show('Salvataggio non riuscito', true);
    } finally {
      setBusy(false);
    }
  };

  const totGg = rows.reduce((s, r) => s + n(r.gg), 0);
  const totImporto = rows.reduce((s, r) => s + n(r.gg) * n(r.tariffa_giornaliera), 0);

  return (
    <div className="card">
      <h3>Giorni uomo · figure · gruppi di lavoro · tariffe</h3>
      <div className="cap">
        Allocazione risorse dell&apos;IF. Totale giorni uomo: <b>{totGg.toLocaleString('it-IT')}</b> · Valore stimato: <b>{EUR(totImporto)}</b>
      </div>
      {!loaded ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Caricamento…</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="datatable">
              <thead>
                <tr>
                  <th>Figura professionale</th>
                  <th>Sigla</th>
                  <th>Gruppo di lavoro</th>
                  <th style={{ textAlign: 'right' }}>Giorni uomo</th>
                  <th style={{ textAlign: 'right' }}>Tariffa gg (€)</th>
                  <th style={{ textAlign: 'right' }}>Valore (€)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><TextInput value={r.figura} onChange={(v) => upd(i, { figura: v })} /></td>
                    <td><TextInput value={r.sigla} width={90} onChange={(v) => upd(i, { sigla: v })} /></td>
                    <td><TextInput value={r.gruppo} onChange={(v) => upd(i, { gruppo: v })} /></td>
                    <td style={{ textAlign: 'right' }}><NumInput value={r.gg} step={0.5} width={90} onChange={(v) => upd(i, { gg: v })} /></td>
                    <td style={{ textAlign: 'right' }}><NumInput value={r.tariffa_giornaliera} width={110} onChange={(v) => upd(i, { tariffa_giornaliera: v })} /></td>
                    <td style={{ textAlign: 'right' }}>{EUR(n(r.gg) * n(r.tariffa_giornaliera))}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="ubtn bad" onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>×</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} style={{ color: 'var(--muted)', padding: 14 }}>Nessuna risorsa allocata.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
            <button
              className="ubtn"
              onClick={() => setRows((l) => [...l, { numero_if: numeroIf, figura: '', sigla: '', gruppo: '', gg: 0, tariffa_giornaliera: 0 }])}
            >
              + Aggiungi risorsa
            </button>
            <button className="exp-save" disabled={busy} onClick={save}>💾 Salva risorse</button>
          </div>
        </>
      )}
    </div>
  );
}

// --- BEF per IF ------------------------------------------------------------
function BefEditor({ numeroIf, show }: { numeroIf: string; show: (m: string, bad?: boolean) => void }) {
  const [rows, setRows] = useState<BefRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/bef/${encodeURIComponent(numeroIf)}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setRows(d.bef || []);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      active = false;
    };
  }, [numeroIf]);

  const upd = (i: number, patch: Partial<BefRow>) =>
    setRows((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bef/${encodeURIComponent(numeroIf)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bef: rows }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setRows(d.bef || []);
      show('Dati BEF salvati');
    } catch {
      show('Salvataggio non riuscito', true);
    } finally {
      setBusy(false);
    }
  };

  const tot = rows.reduce((s, r) => s + n(r.importo_ricezione), 0);

  return (
    <div className="card">
      <h3>Dati BEF · IF {numeroIf}</h3>
      <div className="cap">Voci BEF dell&apos;intervento. Totale importi: <b>{EUR(tot)}</b></div>
      {!loaded ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Caricamento…</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="datatable">
              <thead>
                <tr>
                  <th>Num. BO</th>
                  <th>Descrizione</th>
                  <th>Periodo</th>
                  <th>Fornitore reale</th>
                  <th style={{ textAlign: 'right' }}>Importo (€)</th>
                  <th>N. fattura</th>
                  <th>Data fattura</th>
                  <th>Data pagam.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><TextInput value={r.num_bdo} width={110} onChange={(v) => upd(i, { num_bdo: v })} /></td>
                    <td><TextInput value={r.descrizione} onChange={(v) => upd(i, { descrizione: v })} /></td>
                    <td><TextInput value={r.periodo_competenza} width={100} onChange={(v) => upd(i, { periodo_competenza: v })} /></td>
                    <td><TextInput value={r.fornitore_reale} width={120} onChange={(v) => upd(i, { fornitore_reale: v })} /></td>
                    <td style={{ textAlign: 'right' }}><NumInput value={r.importo_ricezione} width={110} onChange={(v) => upd(i, { importo_ricezione: v })} /></td>
                    <td><TextInput value={r.num_fattura} width={100} onChange={(v) => upd(i, { num_fattura: v })} /></td>
                    <td><TextInput value={r.data_fattura} width={110} placeholder="AAAA-MM-GG" onChange={(v) => upd(i, { data_fattura: v })} /></td>
                    <td><TextInput value={r.data_pagamento} width={110} placeholder="AAAA-MM-GG" onChange={(v) => upd(i, { data_pagamento: v })} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="ubtn bad" onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>×</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={9} style={{ color: 'var(--muted)', padding: 14 }}>Nessuna voce BEF.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
            <button
              className="ubtn"
              onClick={() =>
                setRows((l) => [
                  ...l,
                  { numero_if: numeroIf, num_bdo: '', descrizione: '', periodo_competenza: '', fornitore_reale: '', importo_ricezione: 0, num_fattura: '', data_fattura: '', data_pagamento: '' },
                ])
              }
            >
              + Aggiungi voce BEF
            </button>
            <button className="exp-save" disabled={busy} onClick={save}>💾 Salva BEF</button>
          </div>
        </>
      )}
    </div>
  );
}
