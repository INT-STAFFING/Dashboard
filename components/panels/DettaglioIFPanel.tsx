'use client';
import React, { useDeferredValue, useMemo, useState } from 'react';
import type { DocStatus, Intervento, InterventoInput } from '@/lib/types';
import { EUR0, dfmt, ICO } from '@/lib/format';
import InlineField from '../editing/InlineField';
import StatusSelect from '../editing/StatusSelect';

// Mirrors the "📋 Dettaglio IF" export: stessa sequenza di colonne, stessi
// campi. ICO fornisce colore/etichetta/glifo condivisi con il resto della app.
function DocPill({ v }: { v: DocStatus }) {
  const [color, label, glyph] = ICO[v];
  return (
    <span className="pill" style={{ background: 'color-mix(in srgb, ' + color + ' 14%, #fff)', color }}>
      {glyph} {label}
    </span>
  );
}

function exportCSV(IFs: Intervento[]) {
  const eur = (n: number) => Number(n || 0).toFixed(2).replace('.', ',');
  const lbl = (v: DocStatus) => ICO[v][1];
  const head = [
    'Ambito', 'N° IF', 'N° BO', 'Titolo Intervento', 'Data Inizio', 'Data Fine', 'Ref. ARIA', 'Ref. Fornitore',
    'Fornitore', 'Importo (€)', 'Modalità', 'Stato BO', 'PDC', 'V. Apertura', 'V. SAL', 'BEF', 'Azione Richiesta',
  ];
  const rows = IFs.map((x) => [
    x.ambito || '', x.numero_if, x.bdo || '', x.titolo, dfmt(x.data_inizio), dfmt(x.data_fine), x.ref_aria || '',
    x.ref_fornitore || '', x.fornitore, eur(x.importo), x.modalita_if || '', x.has_bo ? 'BO emesso' : 'In attesa',
    lbl(x.pdc), lbl(x.v_apertura), lbl(x.v_sal), lbl(x.bef), x.azione || '',
  ]);
  const csv = [head, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Dettaglio_IF.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 800);
}

type SortKey = keyof Intervento;

function DettaglioIFPanel({
  IFs,
  canEdit = true,
  onSaveField,
  onOpenEdit,
  onOpenNew,
  onDelete,
  savingIds,
  highlightIds,
}: {
  IFs: Intervento[];
  canEdit?: boolean;
  onSaveField: (numero_if: string, patch: InterventoInput) => void;
  onOpenEdit: (i: Intervento) => void;
  onOpenNew: () => void;
  onDelete: (numero_if: string) => void;
  savingIds: Set<string>;
  highlightIds: Set<string>;
}) {
  const [view, setView] = useState<'table' | 'card'>('table');
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const [sortK, setSortK] = useState<SortKey>('numero_if');
  const [sortDir, setSortDir] = useState(1);

  const rows = useMemo(() => {
    const query = deferredQ.toLowerCase().trim();
    const num = sortK === 'importo';
    return IFs.filter(
      (x) =>
        !query ||
        [x.numero_if, x.bdo, x.titolo, x.ambito, x.ref_aria, x.ref_fornitore, x.fornitore, x.modalita_if, x.azione]
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
  }, [IFs, deferredQ, sortK, sortDir]);

  const sort = (k: SortKey) => {
    if (sortK === k) setSortDir((d) => d * -1);
    else {
      setSortK(k);
      setSortDir(k === 'importo' ? -1 : 1);
    }
  };

  const sumShown = rows.reduce((s, x) => s + x.importo, 0);
  const cols: [SortKey, string][] = [
    ['ambito', 'Ambito'],
    ['numero_if', 'N° IF'],
    ['bdo', 'N° BO'],
    ['titolo', 'Titolo Intervento'],
    ['data_inizio', 'Data Inizio'],
    ['data_fine', 'Data Fine'],
    ['ref_aria', 'Ref. ARIA'],
    ['ref_fornitore', 'Ref. Fornitore'],
    ['fornitore', 'Fornitore'],
    ['importo', 'Importo (€)'],
    ['modalita_if', 'Modalità'],
    ['has_bo', 'Stato BO'],
    ['pdc', 'PDC'],
    ['v_apertura', 'V. Apertura'],
    ['v_sal', 'V. SAL'],
    ['bef', 'BEF'],
    ['azione', 'Azione Richiesta'],
  ];

  return (
    <div className="panel on" data-p="7">
      <div className="phead">
        <h2>Dettaglio IF</h2>
        <p>Vista completa per intervento — Ambito, referenti, importi e stato dei documenti (PDC, verbali, BEF), come nel report Excel.</p>
      </div>
      <div className="tablecard">
        <div className="tbar">
          <h3>Interventi di Fornitura</h3>
          {canEdit && (
            <button className="addbtn" style={{ marginLeft: 8 }} onClick={onOpenNew}>
              + Nuovo IF
            </button>
          )}
          <input
            className="search"
            placeholder="Cerca IF, titolo, referente, ambito…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="seg2">
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} aria-pressed={view === 'table'}>
              📋 Tabella
            </button>
            <button className={view === 'card' ? 'on' : ''} onClick={() => setView('card')} aria-pressed={view === 'card'}>
              🗂️ Card
            </button>
          </div>
          <button className="freset" onClick={() => exportCSV(rows)} style={{ borderColor: 'var(--petrol)', color: 'var(--petrol-d)' }}>
            ⤓ Esporta CSV
          </button>
          <div className="tot">
            Mostrati: <b>{rows.length}</b> · Valore: <b>€ {EUR0(sumShown)}</b>
          </div>
        </div>

        {view === 'table' ? (
          <div className="tscroll noxscroll">
            <table id="tbl-dif">
              <thead>
                <tr>
                  {cols.map(([k, label]) => (
                    <th
                      key={k}
                      className={k === 'titolo' ? 'thtt' : undefined}
                      onClick={() => sort(k)}
                      style={{ cursor: 'pointer' }}
                      aria-sort={sortK === k ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
                    >
                      {label}
                      {sortK === k && <span aria-hidden="true"> {sortDir === 1 ? '▲' : '▼'}</span>}
                    </th>
                  ))}
                  {canEdit && <th>Azioni</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const saving = savingIds.has(x.numero_if);
                  const hl = highlightIds.has(x.numero_if);
                  return (
                    <tr key={x.numero_if} className={hl ? 'row-saved' : ''} style={saving ? { opacity: 0.55 } : undefined}>
                      <td>{x.ambito || '—'}</td>
                      <td className="codecell">{x.numero_if}</td>
                      <td className="codecell" style={{ color: 'var(--muted)' }}>
                        {x.bdo || '—'}
                      </td>
                      <td className="tt">
                        <details className="ttd">
                          <summary title="Clic per espandere/comprimere il testo">
                            <b>{x.titolo}</b>
                            {x.subappalto && <span className="pill sub" style={{ marginLeft: 6 }}>sub</span>}
                          </summary>
                        </details>
                      </td>
                      <td className="codecell" style={{ color: 'var(--muted)' }}>
                        {canEdit ? (
                          <InlineField type="date" value={x.data_inizio} display={dfmt(x.data_inizio)} onSave={(v) => onSaveField(x.numero_if, { data_inizio: v || null })} />
                        ) : (
                          dfmt(x.data_inizio)
                        )}
                      </td>
                      <td className="codecell" style={{ color: 'var(--muted)' }}>
                        {canEdit ? (
                          <InlineField type="date" value={x.data_fine} display={dfmt(x.data_fine)} onSave={(v) => onSaveField(x.numero_if, { data_fine: v || null })} />
                        ) : (
                          dfmt(x.data_fine)
                        )}
                      </td>
                      <td>{x.ref_aria || '—'}</td>
                      <td>{x.ref_fornitore || '—'}</td>
                      <td>
                        <span className={'pill f-' + x.fornitore}>{x.fornitore}</span>
                      </td>
                      <td className="num">
                        {canEdit ? (
                          <InlineField type="number" value={x.importo} display={EUR0(x.importo)} onSave={(v) => onSaveField(x.numero_if, { importo: Number(v) || 0 })} />
                        ) : (
                          EUR0(x.importo)
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <InlineField value={x.modalita_if} onSave={(v) => onSaveField(x.numero_if, { modalita_if: v })} />
                        ) : (
                          x.modalita_if || '—'
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={'pill ' + (x.has_bo ? 'bo' : 'nobo')}>{x.has_bo ? 'BO emesso' : 'In attesa'}</span>
                      </td>
                      {(['pdc', 'v_apertura', 'v_sal', 'bef'] as const).map((k) => (
                        <td key={k} style={{ textAlign: 'center' }}>
                          {canEdit ? (
                            <StatusSelect value={x[k]} disabled={saving} onChange={(v) => onSaveField(x.numero_if, { [k]: v })} />
                          ) : (
                            <DocPill v={x[k]} />
                          )}
                        </td>
                      ))}
                      <td>
                        {canEdit ? (
                          <InlineField value={x.azione} onSave={(v) => onSaveField(x.numero_if, { azione: v || null })} className="tt" />
                        ) : (
                          x.azione || '—'
                        )}
                      </td>
                      {canEdit && (
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
                      )}
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 18 : 17} style={{ color: 'var(--muted)', padding: 18 }}>
                      Nessun IF in questa vista.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="difcards">
            {rows.map((x) => {
              const saving = savingIds.has(x.numero_if);
              const hl = highlightIds.has(x.numero_if);
              return (
                <div key={x.numero_if} className={'difcard' + (hl ? ' row-saved' : '')} style={saving ? { opacity: 0.55 } : undefined}>
                  <div className="difcard-head">
                    <div>
                      <span className="codecell">{x.numero_if}</span>
                      {x.ambito && <span className="pill" style={{ marginLeft: 6 }}>{x.ambito}</span>}
                      {x.subappalto && <span className="pill sub" style={{ marginLeft: 6 }}>sub</span>}
                    </div>
                    <span className={'pill f-' + x.fornitore}>{x.fornitore}</span>
                  </div>
                  <h4 className="difcard-title">{x.titolo}</h4>
                  <div className="difcard-meta">
                    <span>N° BO: <b>{x.bdo || '—'}</b></span>
                    <span>Ref. ARIA: <b>{x.ref_aria || '—'}</b></span>
                    <span>Ref. Fornitore: <b>{x.ref_fornitore || '—'}</b></span>
                  </div>
                  <div className="difcard-meta">
                    <span>
                      Inizio:{' '}
                      {canEdit ? (
                        <InlineField type="date" value={x.data_inizio} display={dfmt(x.data_inizio)} onSave={(v) => onSaveField(x.numero_if, { data_inizio: v || null })} />
                      ) : (
                        <b>{dfmt(x.data_inizio)}</b>
                      )}
                    </span>
                    <span>
                      Fine:{' '}
                      {canEdit ? (
                        <InlineField type="date" value={x.data_fine} display={dfmt(x.data_fine)} onSave={(v) => onSaveField(x.numero_if, { data_fine: v || null })} />
                      ) : (
                        <b>{dfmt(x.data_fine)}</b>
                      )}
                    </span>
                    <span>
                      Modalità:{' '}
                      {canEdit ? (
                        <InlineField value={x.modalita_if} onSave={(v) => onSaveField(x.numero_if, { modalita_if: v })} />
                      ) : (
                        <b>{x.modalita_if || '—'}</b>
                      )}
                    </span>
                  </div>
                  <div className="difcard-amount">
                    {canEdit ? (
                      <InlineField
                        type="number"
                        value={x.importo}
                        display={'€ ' + EUR0(x.importo)}
                        onSave={(v) => onSaveField(x.numero_if, { importo: Number(v) || 0 })}
                      />
                    ) : (
                      '€ ' + EUR0(x.importo)
                    )}
                    <span className={'pill ' + (x.has_bo ? 'bo' : 'nobo')} style={{ marginLeft: 10 }}>
                      {x.has_bo ? 'BO emesso' : 'In attesa'}
                    </span>
                  </div>
                  <div className="difcard-docs">
                    {(['pdc', 'v_apertura', 'v_sal', 'bef'] as const).map((k) => (
                      <div className="difcard-doc" key={k}>
                        <span className="difcard-doc-label">{{ pdc: 'PDC', v_apertura: 'V. Apertura', v_sal: 'V. SAL', bef: 'BEF' }[k]}</span>
                        {canEdit ? (
                          <StatusSelect value={x[k]} disabled={saving} onChange={(v) => onSaveField(x.numero_if, { [k]: v })} />
                        ) : (
                          <DocPill v={x[k]} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="difcard-azione">
                    <span className="difcard-doc-label">Azione Richiesta</span>
                    {canEdit ? (
                      <InlineField value={x.azione} onSave={(v) => onSaveField(x.numero_if, { azione: v || null })} />
                    ) : (
                      <span>{x.azione || '—'}</span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="difcard-actions">
                      <button className="iconbtn" title="Modifica completa" onClick={() => onOpenEdit(x)}>
                        ✏️ Modifica
                      </button>
                      <button
                        className="iconbtn"
                        title="Elimina"
                        onClick={() => {
                          if (window.confirm(`Eliminare l'IF ${x.numero_if}? (soft-delete)`)) onDelete(x.numero_if);
                        }}
                      >
                        🗑️ Elimina
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && <div className="empty">Nessun IF in questa vista.</div>}
          </div>
        )}
      </div>
      <div className="foot" style={{ marginTop: 10 }}>
        {canEdit ? (
          <>
            Modifica inline in entrambe le viste: clic su titoli, importi, date, modalità e azione richiesta · usa i menu per
            PDC/verbali/BEF · ✏️ per il form completo · 🗑️ per eliminare (soft-delete).
          </>
        ) : (
          <>Hai accesso in sola visualizzazione: i dati non sono modificabili. Puoi comunque cercare, ordinare ed esportare in CSV.</>
        )}
      </div>
    </div>
  );
}

export default React.memo(DettaglioIFPanel);
