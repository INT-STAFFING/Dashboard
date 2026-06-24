'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Intervento } from '@/lib/types';
import { filterInterventi, matchesMod, type Filters } from '@/lib/queries';
import { EUR } from '@/lib/format';

const uniq = (arr: (string | null)[]) =>
  [...new Set(arr)].filter(Boolean).sort((a, b) => (a as string).localeCompare(b as string, 'it')) as string[];

type Opt = { value: string; count: number };

// ---------------------------------------------------------------------------
// Generic dropdown (checkbox = multi, radio = single).
// Owns: open/close, click-outside, Escape, search field (auto when >7 options),
// autofocus on open. Selections are controlled by the parent so they survive
// open/close cycles (Level-1 redundancy: state preserved inside the dropdown).
// ---------------------------------------------------------------------------
function FilterDropdown({
  label,
  options,
  selected,
  multiple,
  onToggle,
  onClear,
}: {
  label: string;
  options: Opt[];
  selected: string[];
  multiple: boolean;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Search box only appears for long lists, where scanning a flat list is slow.
  const searchable = options.length > 7;
  const n = selected.length;

  // Close on Escape + click outside (native <select> gave this for free).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Autofocus the search field when the dropdown opens; reset query on close.
  useEffect(() => {
    if (open && searchable) {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    if (!open) setQ('');
  }, [open, searchable]);

  const shown = q ? options.filter((o) => o.value.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <div className="fdd" ref={rootRef}>
      {/* Level-2 redundancy: active label goes bold + numeric badge (n). */}
      <button
        type="button"
        className={'fdd-trig' + (n ? ' on' : '')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Filtro ${label}${n ? `: ${n} selezionati` : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fdd-lab">{label}</span>
        {n > 0 && <span className="fdd-badge">{n}</span>}
        <span className="fdd-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="fdd-pop" role="listbox" aria-label={label}>
          {searchable && (
            <input
              ref={searchRef}
              className="fdd-search"
              type="text"
              placeholder="Cerca…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={`Cerca in ${label}`}
            />
          )}
          {/* Single-select gets an explicit "Tutte" radio to clear the choice. */}
          {!multiple && (
            <label className="fdd-opt">
              <input type="radio" name={`r-${label}`} checked={n === 0} onChange={onClear} />
              <span className="fdd-optlab">Tutte</span>
            </label>
          )}
          <div className="fdd-list">
            {shown.map((o) => {
              const checked = selected.includes(o.value);
              // Faceted UX: an option that would yield 0 results is shown but
              // disabled (unless already active, so it stays removable).
              const disabled = o.count === 0 && !checked;
              return (
                <label key={o.value} className={'fdd-opt' + (disabled ? ' dis' : '')}>
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name={multiple ? undefined : `r-${label}`}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(o.value)}
                  />
                  <span className="fdd-optlab">{o.value}</span>
                  <span className="fdd-optcount">{o.count}</span>
                </label>
              );
            })}
            {shown.length === 0 && <div className="fdd-none">Nessuna opzione</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline boolean toggle — no dropdown for yes/no dimensions.
function FilterToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={'ftgl' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}
    >
      <span className="ftgl-track" aria-hidden>
        <span className="ftgl-knob" />
      </span>
      <span className="ftgl-lab">{label}</span>
    </button>
  );
}

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
  const [showMore, setShowMore] = useState(false);

  // Option domains (full set, so 0-result options can still render disabled).
  const fornDomain = useMemo(
    () => fornitoriFilter.filter((f) => interventi.some((i) => i.fornitore === f)),
    [fornitoriFilter, interventi],
  );
  const refDomain = useMemo(() => uniq(interventi.map((i) => i.ref_aria)), [interventi]);
  const refintDomain = useMemo(() => uniq(interventi.map((i) => i.ref_fornitore)), [interventi]);
  const ambDomain = useMemo(() => uniq(interventi.map((i) => i.ambito)), [interventi]);
  const statoDomain = useMemo(() => uniq(interventi.map((i) => i.stato)), [interventi]);
  const MOD_DOMAIN = ['A corpo', 'A canone', 'A consumo'];

  // --- update helpers ------------------------------------------------------
  const toggleMulti = (key: 'forn' | 'ref' | 'refint' | 'amb' | 'stato', value: string) => {
    const cur = filters[key] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setFilters({ ...filters, [key]: next.length ? next : undefined });
  };
  const clearKey = (key: keyof Filters) => {
    const f = { ...filters };
    delete f[key];
    setFilters(f);
  };
  const setSingle = (key: 'mod', value: string) => setFilters({ ...filters, [key]: value || undefined });
  const setBool = (key: 'att' | 'bo' | 'sub', on: boolean) =>
    setFilters({ ...filters, [key]: on ? 'SI' : undefined });

  // Faceted counts: count each option against all OTHER active filters, so the
  // number reflects "results if I also pick this". 0 ⇒ option is disabled.
  const facet = (key: keyof Filters, domain: string[], get: (i: Intervento) => string | null): Opt[] => {
    const base = filterInterventi(interventi, { ...filters, [key]: undefined });
    const counts: Record<string, number> = {};
    for (const i of base) {
      const v = get(i);
      if (v != null) counts[v] = (counts[v] || 0) + 1;
    }
    return domain.map((v) => ({ value: v, count: counts[v] || 0 }));
  };

  const fornOpts = facet('forn', fornDomain, (i) => i.fornitore);
  const statoOpts = facet('stato', statoDomain, (i) => i.stato);
  const ambOpts = facet('amb', ambDomain, (i) => i.ambito);
  const refOpts = facet('ref', refDomain, (i) => i.ref_aria);
  const refintOpts = facet('refint', refintDomain, (i) => i.ref_fornitore);
  const modBase = filterInterventi(interventi, { ...filters, mod: undefined });
  const modOpts: Opt[] = MOD_DOMAIN.map((v) => ({
    value: v,
    count: modBase.filter((i) => matchesMod(i.modalita_if, v)).length,
  }));

  // --- applied-filter pills (Level-3 redundancy) ---------------------------
  const pills: { id: string; text: string; remove: () => void }[] = [];
  const MULTI: { key: 'forn' | 'ref' | 'refint' | 'amb' | 'stato'; label: string }[] = [
    { key: 'forn', label: 'Fornitore' },
    { key: 'stato', label: 'Stato' },
    { key: 'amb', label: 'Ambito' },
    { key: 'ref', label: 'Ref. ARIA' },
    { key: 'refint', label: 'Ref. Intellera' },
  ];
  MULTI.forEach((d) =>
    (filters[d.key] ?? []).forEach((v) =>
      pills.push({ id: `${d.key}-${v}`, text: `${d.label}: ${v}`, remove: () => toggleMulti(d.key, v) }),
    ),
  );
  if (filters.mod) pills.push({ id: 'mod', text: `Modalità: ${filters.mod}`, remove: () => clearKey('mod') });
  if (filters.att) pills.push({ id: 'att', text: 'Solo attivazione immediata', remove: () => clearKey('att') });
  if (filters.bo) pills.push({ id: 'bo', text: 'Con BO emesso', remove: () => clearKey('bo') });
  if (filters.sub) pills.push({ id: 'sub', text: 'Con subappalto', remove: () => clearKey('sub') });

  const hasActive = pills.length > 0;
  const noResults = viewCount === 0 && hasActive;

  return (
    <div className="filterbar">
      <div className="wrap fbar">
        {/* Order = priority: most-used dimensions first (left). */}
        <div className="fbar-row">
          <FilterDropdown
            label="Fornitore"
            options={fornOpts}
            selected={filters.forn ?? []}
            multiple
            onToggle={(v) => toggleMulti('forn', v)}
            onClear={() => clearKey('forn')}
          />
          <FilterDropdown
            label="Stato IF"
            options={statoOpts}
            selected={filters.stato ?? []}
            multiple
            onToggle={(v) => toggleMulti('stato', v)}
            onClear={() => clearKey('stato')}
          />
          <FilterDropdown
            label="Ambito"
            options={ambOpts}
            selected={filters.amb ?? []}
            multiple
            onToggle={(v) => toggleMulti('amb', v)}
            onClear={() => clearKey('amb')}
          />
          {/* Single-select (radio): an IF has one modalità. */}
          <FilterDropdown
            label="Modalità"
            options={modOpts}
            selected={filters.mod ? [filters.mod] : []}
            multiple={false}
            onToggle={(v) => setSingle('mod', v)}
            onClear={() => clearKey('mod')}
          />
          <FilterDropdown
            label="Ref. ARIA"
            options={refOpts}
            selected={filters.ref ?? []}
            multiple
            onToggle={(v) => toggleMulti('ref', v)}
            onClear={() => clearKey('ref')}
          />
          <FilterDropdown
            label="Ref. Intellera"
            options={refintOpts}
            selected={filters.refint ?? []}
            multiple
            onToggle={(v) => toggleMulti('refint', v)}
            onClear={() => clearKey('refint')}
          />

          {/* Primary boolean is an inline toggle, not a dropdown. */}
          <FilterToggle label="Att. imm." on={filters.att === 'SI'} onChange={(v) => setBool('att', v)} />

          {/* Secondary, less-used filters tucked behind "Più filtri". */}
          <button
            type="button"
            className={'fmore' + (showMore ? ' on' : '')}
            aria-expanded={showMore}
            aria-label="Mostra filtri secondari"
            onClick={() => setShowMore((s) => !s)}
          >
            Più filtri {showMore ? '▴' : '▾'}
          </button>
          {showMore && (
            <>
              <FilterToggle label="Con BO" on={filters.bo === 'SI'} onChange={(v) => setBool('bo', v)} />
              <FilterToggle label="Subappalto" on={filters.sub === 'SI'} onChange={(v) => setBool('sub', v)} />
            </>
          )}

          <div className="fbar-spacer" />

          {/* Live result count — updates in real time as filters change. */}
          <div className="fcount" aria-live="polite">
            <b>{viewCount}</b> IF · {EUR(viewTot)}
          </div>

          {/* Global Clear-all — only present when something is active. */}
          {hasActive && (
            <button type="button" className="fclear" onClick={() => setFilters({})} aria-label="Rimuovi tutti i filtri">
              ✕ Rimuovi filtri
            </button>
          )}
        </div>

        {/* Additive lozenges: one removable pill per active value. */}
        {hasActive && (
          <div className="fpills" aria-label="Filtri applicati">
            {pills.map((p) => (
              <button key={p.id} type="button" className="fpill" onClick={p.remove} aria-label={`Rimuovi filtro ${p.text}`}>
                {p.text}
                <span className="fpill-x" aria-hidden>
                  ×
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Explicit empty state with a way out. */}
        {noResults && (
          <div className="fempty" role="status">
            <span>Nessun risultato con i filtri selezionati.</span>
            <button type="button" className="flink" onClick={() => setFilters({})}>
              Rimuovi filtri
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
