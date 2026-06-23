'use client';
import React, { useMemo, useState } from 'react';
import type { Intervento, InterventoInput, DocStatus } from '@/lib/types';
import { EUR0, dfmt } from '@/lib/format';
import InlineField from '../editing/InlineField';
import StatusSelect from '../editing/StatusSelect';

const ST_TXT: Record<DocStatus, string> = { ok: 'OK', ko: 'Mancante', prog: 'In corso', nd: 'N/D' };

function exportCSV(IFs: Intervento[]) {
  const eur = (n: number) => Number(n || 0).toFixed(2).replace('.', ',');
  const head = [
    'Numero IF', 'BDO', 'Titolo', 'Ambito', 'Fornitore', 'Referente ARIA', 'Referente Intellera',
    'Modalità', 'Attivazione immediata', 'Stato', 'Data assegnazione', 'Data inizio', 'Data fine',
    'PDC', 'V. Apertura', 'V. SAL', 'BEF', 'Importo', 'Revenue 2026', 'Subappalto',
  ];
  const rows = [...IFs]
    .sort((a, b) => b.importo - a.importo)
    .map((x) => [
      x.numero_if, x.bdo || '', x.titolo, x.ambito || '', x.fornitore, x.ref_aria || '', x.ref_fornitore || '',
      x.modalita_if || '', x.attivazione || '', x.stato, x.data_assegnazione || '', x.data_inizio || '', x.data_fine || '',
      ST_TXT[x.pdc], ST_TXT[x.v_apertura], ST_TXT[x.v_sal], ST_TXT[x.bef], eur(x.importo), eur(x.revenue_2026),
      x.subappalto ? 'Sì' : 'No',
    ]);
  const csv = [head, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Registro_IF.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 800);
}

type SortKey = keyof Intervento;

export default function RegistroPanel({
  IFs,
  onSaveField,
  onOpenEdit,
  onOpenNew,
  onDelete,
  savingIds,
  highlightIds,
}: {
  IFs: Intervento[];
  onSaveField: (numero_if: string, patch: InterventoInput) => void;
  onOpenEdit: (i: Intervento) => void;
  onOpenNew: () => void;
  onDelete: (numero_if: string) => void;
  savingIds: Set<string>;
  highlightIds: Set<string>;
}) {
  const [q, setQ] = useState('');
  const [sortK, setSortK] = useState<SortKey>('importo');
  const [sortDir, setSortDir] = useState(-1);

  const rows = useMemo(() => {
    const query = q.toLowerCase().trim();
    const num = sortK === 'importo' || sortK === 'revenue_2026';
    return IFs.filter(
      (x) =>
        !query ||
        [x.numero_if, x.titolo, x.ref_aria, x.ref_fornitore, x.ambito, x.bdo, x.stato, x.modalita_if]
          .join(' ')
          .toLowerCase()
          .includes(query),
    ).sort((a, b) => {
      let va: string | number = a[sortK] as never;
      let vb: string | number = b[sortK] as never;
      if (num) {
        va = Number(va) || 0;
        vb = Number(vb) || 0;
      } else {
        va = (va == null ? '' : String(va)).toLowerCase();
        vb = (vb == null ? '' : String(vb)).toLowerCase();
      }
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
  }, [IFs, q, sortK, sortDir]);

  const sort = (k: SortKey) => {
    if (sortK === k) setSortDir((d) => d * -1);
    else {
      setSortK(k);
      setSortDir(k === 'importo' || k === 'revenue_2026' ? -1 : 1);
    }
  };

  const sumShown = rows.reduce((s, x) => s + x.importo, 0);
  const cols: [SortKey, string][] = [
    ['numero_if', 'IF'],
    ['bdo', 'N° BO'],
    ['titolo', 'Intervento / Referente'],
    ['modalita_if', 'Modalità'],
    ['attivazione', 'Att.imm.'],
    ['stato', 'Stato BO'],
    ['pdc', 'PDC'],
    ['v_apertura', 'V.Ap.'],
    ['v_sal', 'V.SAL'],
    ['bef', 'BEF'],
    ['data_inizio', 'Inizio'],
    ['data_fine', 'Fine'],
    ['importo', 'Importo €'],
  ];

  return (
    <div className="panel on" data-p="6">
      <div className="phead">
        <h2>Operativo</h2>
        <p>Registro IF con stato di lavorazione (PDC, verbali, BEF), filtrabile, ordinabile ed editabile.</p>
      </div>
      <div className="tablecard">
        <div className="tbar">
          <h3>Interventi di Fornitura</h3>
          <button className="addbtn" style={{ marginLeft: 8 }} onClick={onOpenNew}>
            + Nuovo IF
          </button>
          <input className="search" placeholder="Cerca IF, titolo, referente, ambito…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="freset" onClick={() => exportCSV(rows)} style={{ borderColor: 'var(--petrol)', color: 'var(--petrol-d)' }}>
            ⤓ Esporta CSV
          </button>
          <div className="tot">
            Mostrati: <b>{rows.length}</b> · Valore: <b>€ {EUR0(sumShown)}</b>
          </div>
        </div>
        <div className="tscroll noxscroll">
          <table id="tbl">
            <thead>
              <tr>
                {cols.map(([k, label]) => (
                  <th key={k} onClick={() => sort(k)} style={{ cursor: 'pointer' }}>
                    {label}
                  </th>
                ))}
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const saving = savingIds.has(x.numero_if);
                const hl = highlightIds.has(x.numero_if);
                return (
                  <tr key={x.numero_if} className={hl ? 'row-saved' : ''} style={saving ? { opacity: 0.55 } : undefined}>
                    <td className="codecell">{x.numero_if}</td>
                    <td className="codecell" style={{ color: 'var(--muted)' }}>
                      {x.bdo || '—'}
                    </td>
                    <td className="tt">
                      <b>{x.titolo}</b>
                      {x.subappalto ? <span className="pill sub"> sub</span> : null}
                      <br />
                      <span className="ref">
                        ARIA: {x.ref_aria || '—'} · Int.: {x.ref_fornitore || '—'}
                      </span>
                    </td>
                    <td>
                      <InlineField value={x.modalita_if} onSave={(v) => onSaveField(x.numero_if, { modalita_if: v })} />
                    </td>
                    <td>
                      <select
                        className="stsel"
                        value={x.attivazione || 'NO'}
                        disabled={saving}
                        onChange={(e) => onSaveField(x.numero_if, { attivazione: e.target.value })}
                      >
                        <option value="SI">SI</option>
                        <option value="NO">NO</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="stsel"
                        value={x.stato}
                        disabled={saving}
                        onChange={(e) =>
                          onSaveField(x.numero_if, { stato: e.target.value, has_bo: e.target.value === 'approvato' })
                        }
                      >
                        <option value="approvato">approvato</option>
                        <option value="non elaborato">non elab.</option>
                      </select>
                    </td>
                    {(['pdc', 'v_apertura', 'v_sal', 'bef'] as const).map((k) => (
                      <td key={k} style={{ textAlign: 'center' }}>
                        <StatusSelect value={x[k]} disabled={saving} onChange={(v) => onSaveField(x.numero_if, { [k]: v })} />
                      </td>
                    ))}
                    <td className="codecell" style={{ color: 'var(--muted)' }}>
                      <InlineField type="date" value={x.data_inizio} display={dfmt(x.data_inizio)} onSave={(v) => onSaveField(x.numero_if, { data_inizio: v || null })} />
                    </td>
                    <td className="codecell" style={{ color: 'var(--muted)' }}>
                      <InlineField type="date" value={x.data_fine} display={dfmt(x.data_fine)} onSave={(v) => onSaveField(x.numero_if, { data_fine: v || null })} />
                    </td>
                    <td className="num">
                      <InlineField type="number" value={x.importo} display={EUR0(x.importo)} onSave={(v) => onSaveField(x.numero_if, { importo: Number(v) || 0 })} />
                    </td>
                    <td className="actcell">
                      <button className="iconbtn" title="Modifica completa" onClick={() => onOpenEdit(x)}>
                        ✏️
                      </button>
                      <button
                        className="iconbtn"
                        title="Elimina"
                        onClick={() => {
                          if (window.confirm(`Eliminare l'IF ${x.numero_if}? (soft-delete)`)) onDelete(x.numero_if);
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={14} style={{ color: 'var(--muted)', padding: 18 }}>
                    Nessun IF in questa vista.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="foot" style={{ marginTop: 10 }}>
        Modifica inline: clic su modalità, importo o date · usa i menu per stato/PDC/verbali · ✏️ per il form completo · 🗑️
        per eliminare (soft-delete). Le modifiche manuali non vengono sovrascritte dal successivo upload Excel (salvo
        <span className="mono"> ?force=true</span>).
      </div>
    </div>
  );
}
