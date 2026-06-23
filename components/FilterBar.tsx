'use client';
import React, { useMemo } from 'react';
import type { Intervento } from '@/lib/types';
import type { Filters } from '@/lib/queries';
import { EUR } from '@/lib/format';

const uniq = (arr: (string | null)[]) =>
  [...new Set(arr)].filter(Boolean).sort((a, b) => (a as string).localeCompare(b as string, 'it')) as string[];

export default function FilterBar({
  interventi,
  fornitoriFilter,
  filters,
  setFilters,
  viewCount,
  viewTot,
}: {
  interventi: Intervento[];
  fornitoriFilter: string[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  viewCount: number;
  viewTot: number;
}) {
  const forn = useMemo(
    () => fornitoriFilter.filter((f) => interventi.some((i) => i.fornitore === f)),
    [fornitoriFilter, interventi],
  );
  const refs = useMemo(() => uniq(interventi.map((i) => i.ref_aria)), [interventi]);
  const refints = useMemo(() => uniq(interventi.map((i) => i.ref_fornitore)), [interventi]);
  const ambs = useMemo(() => uniq(interventi.map((i) => i.ambito)), [interventi]);
  const stati = useMemo(() => uniq(interventi.map((i) => i.stato)), [interventi]);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setFilters({ ...filters, [k]: e.target.value || undefined });

  const reset = () => setFilters({});

  const parts: string[] = [];
  if (filters.forn) parts.push(filters.forn);
  if (filters.ref) parts.push('Ref.ARIA ' + filters.ref);
  if (filters.refint) parts.push('Ref.Int. ' + filters.refint);
  if (filters.amb) parts.push(filters.amb);
  if (filters.att) parts.push('Att.imm: ' + filters.att);
  if (filters.mod) parts.push(filters.mod);
  if (filters.stato) parts.push('Stato: ' + filters.stato);

  return (
    <div className="filterbar">
      <div className="wrap">
        <div className="fgroup">
          <label>Fornitore</label>
          <select className="fsel" value={filters.forn || ''} onChange={set('forn')}>
            <option value="">Tutti i fornitori</option>
            {forn.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="fgroup">
          <label>Referente ARIA</label>
          <select className="fsel" value={filters.ref || ''} onChange={set('ref')}>
            <option value="">Tutti i referenti</option>
            {refs.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="fgroup">
          <label>Referente Intellera</label>
          <select className="fsel" value={filters.refint || ''} onChange={set('refint')}>
            <option value="">Tutti i referenti Intellera</option>
            {refints.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="fgroup">
          <label>Ambito</label>
          <select className="fsel" value={filters.amb || ''} onChange={set('amb')}>
            <option value="">Tutti gli ambiti</option>
            {ambs.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="fgroup">
          <label>Attiv. imm.</label>
          <select className="fsel" value={filters.att || ''} onChange={set('att')}>
            <option value="">Tutte (attiv.)</option>
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </select>
        </div>
        <div className="fgroup">
          <label>Modalità</label>
          <select className="fsel" value={filters.mod || ''} onChange={set('mod')}>
            <option value="">Tutte le modalità</option>
            <option value="A corpo">A corpo</option>
            <option value="A canone">A canone</option>
            <option value="A consumo">A consumo</option>
          </select>
        </div>
        <div className="fgroup">
          <label>Stato IF</label>
          <select className="fsel" value={filters.stato || ''} onChange={set('stato')}>
            <option value="">Tutti gli stati</option>
            {stati.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <button className="freset" onClick={reset}>
          Azzera filtri
        </button>
        <div
          className="fctx"
          dangerouslySetInnerHTML={{
            __html:
              (parts.length
                ? 'Filtri: <b>' + parts.join('</b> · <b>') + '</b> — '
                : 'Nessun filtro — ') + `<b>${viewCount} IF</b> · ${EUR(viewTot)}`,
          }}
        />
      </div>
    </div>
  );
}
