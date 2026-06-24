'use client';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import type { DashboardData, Intervento, InterventoInput, RtiConfig, SafeUser } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/auth/permissions';
import { filterInterventi, type Filters } from '@/lib/queries';
import FilterBar from './FilterBar';
import LogoutButton from './LogoutButton';
import OverviewPanel from './panels/OverviewPanel';
import RTIPanel from './panels/RTIPanel';
import TimelinePanel from './panels/TimelinePanel';
import DistribuzionePanel from './panels/DistribuzionePanel';
import ModalitaPanel from './panels/ModalitaPanel';
import StatoPanel from './panels/StatoPanel';
import RegistroPanel from './panels/RegistroPanel';
import EditDrawer from './editing/EditDrawer';

const TABS = ['Overview', 'Quote RTI', 'Timeline', 'Distribuzione', 'Modalità fornitura', 'Stato IF / BO', 'Operativo'];
const REGISTRO_TAB = 6;

export default function Dashboard({
  initial,
  user,
  canEdit,
  isAdmin,
}: {
  initial: DashboardData;
  user: SafeUser;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [interventi, setInterventi] = useState<Intervento[]>(initial.interventi);
  const [rti, setRti] = useState<RtiConfig>(initial.rti);
  const [quotaVal, setQuotaVal] = useState<Record<string, number>>(initial.quota_val);

  // SSR re-runs (e.g. after an upload + router.refresh()) deliver fresh data via
  // the `initial` prop. useState ignores prop changes after mount, so sync the
  // server-derived state whenever a new payload arrives, otherwise the view
  // keeps showing the data captured at first mount.
  useEffect(() => {
    setInterventi(initial.interventi);
    setRti(initial.rti);
    setQuotaVal(initial.quota_val);
  }, [initial]);
  const [filters, setFilters] = useState<Filters>({});
  const [tab, setTab] = useState(0);
  const [rtiSel, setRtiSel] = useState<string | null>(null);
  const [tlMode, setTlMode] = useState<'mese' | 'trim'>('mese');
  const [distSub, setDistSub] = useState(0);
  const [editMode, setEditMode] = useState(false);

  const [drawer, setDrawer] = useState<{ open: boolean; mode: 'edit' | 'new'; initial: Intervento | null }>({
    open: false,
    mode: 'edit',
    initial: null,
  });
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);

  const IFs = useMemo(() => filterInterventi(interventi, filters), [interventi, filters]);
  const viewTot = IFs.reduce((s, i) => s + i.importo, 0);
  // RTI quota panels are meaningful only for a single fornitore in scope.
  const singleForn = filters.forn?.length === 1 ? filters.forn[0] : undefined;

  const showToast = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad });
    setTimeout(() => setToast(null), 2600);
  }, []);

  const flashRow = useCallback((id: string) => {
    setHighlightIds((s) => new Set(s).add(id));
    setTimeout(() => {
      setHighlightIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, 1300);
  }, []);

  // floating tooltip for [data-tip] elements
  useEffect(() => {
    const tip = document.createElement('div');
    tip.id = 'tip';
    tip.style.display = 'none';
    document.body.appendChild(tip);
    const move = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
      if (!t) {
        tip.style.display = 'none';
        return;
      }
      tip.textContent = t.getAttribute('data-tip') || '';
      tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 12) + 'px';
      tip.style.top = e.clientY + 16 + 'px';
    };
    const hide = () => (tip.style.display = 'none');
    document.addEventListener('mousemove', move);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('scroll', hide, true);
      tip.remove();
    };
  }, []);

  const setSaving = (id: string, on: boolean) =>
    setSavingIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // --- editing handlers (optimistic) ---
  const onSaveField = useCallback(
    async (numero_if: string, patch: InterventoInput) => {
      const prev = interventi;
      setInterventi((list) => list.map((i) => (i.numero_if === numero_if ? ({ ...i, ...patch } as Intervento) : i)));
      setSaving(numero_if, true);
      try {
        const res = await fetch(`/api/interventi/${encodeURIComponent(numero_if)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setInterventi((list) => list.map((i) => (i.numero_if === numero_if ? (data.updated as Intervento) : i)));
        flashRow(numero_if);
      } catch {
        setInterventi(prev);
        showToast('Salvataggio non riuscito', true);
      } finally {
        setSaving(numero_if, false);
      }
    },
    [interventi, flashRow, showToast],
  );

  const onSaveDrawer = useCallback(
    async (input: InterventoInput, isNew: boolean): Promise<boolean> => {
      try {
        if (isNew) {
          const res = await fetch('/api/interventi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          });
          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast(e.error || 'Creazione non riuscita', true);
            return false;
          }
          const data = await res.json();
          setInterventi((list) => [data.created as Intervento, ...list]);
          flashRow((data.created as Intervento).numero_if);
          showToast('Intervento creato');
        } else {
          const id = input.numero_if as string;
          const res = await fetch(`/api/interventi/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          });
          if (!res.ok) {
            showToast('Salvataggio non riuscito', true);
            return false;
          }
          const data = await res.json();
          setInterventi((list) => list.map((i) => (i.numero_if === id ? (data.updated as Intervento) : i)));
          flashRow(id);
          showToast('Modifiche salvate');
        }
        return true;
      } catch {
        showToast('Errore di rete', true);
        return false;
      }
    },
    [flashRow, showToast],
  );

  const onDelete = useCallback(
    async (numero_if: string) => {
      const prev = interventi;
      setInterventi((list) => list.filter((i) => i.numero_if !== numero_if));
      try {
        const res = await fetch(`/api/interventi/${encodeURIComponent(numero_if)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        showToast(`IF ${numero_if} eliminato`);
      } catch {
        setInterventi(prev);
        showToast('Eliminazione non riuscita', true);
      }
    },
    [interventi, showToast],
  );

  const onUpdateRti = useCallback(
    async (u: { massimale_totale: number; quota_intellera_pct: number; quota_deloitte_pct: number }) => {
      try {
        const res = await fetch('/api/config/rti', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(u),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRti((cur) => ({ ...cur, ...(data.rti as RtiConfig) }));
        const qv: Record<string, number> = { ...quotaVal };
        (data.rti as RtiConfig).partners.forEach((p) => (qv[p.name] = p.quota));
        setQuotaVal(qv);
        showToast('Parametri RTI aggiornati');
      } catch {
        showToast('Aggiornamento RTI non riuscito', true);
      }
    },
    [quotaVal, showToast],
  );

  const drillTo = (patch: Filters) => {
    setFilters((f) => ({ ...f, ...patch }));
    setTab(REGISTRO_TAB);
  };

  return (
    <>
      <header>
        <div className="wrap brandrow">
          <div>
            <div className="eyebrow">Executive Dashboard · Intellera</div>
            <h1>Monitor IF/BO · ARIA SISS L2</h1>
          </div>
          <div className="hdr-right">
            <div className="metaline">
              CIG <b>{initial.meta.cig}</b> · agg.{' '}
              <b>{new Date(initial.meta.generato).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}</b>
            </div>
            <div className="userchip">
              <span className="uname">{user.name || user.email}</span>
              <span className="rolepill" title={ROLE_LABEL[user.role]}>{user.role}</span>
            </div>
            <div className="exp">
              {canEdit && (
                <button className={editMode ? '' : 'ghost'} onClick={() => setEditMode((v) => !v)}>
                  {editMode ? '🔓 Modalità modifica attiva' : '🔒 Abilita modifica'}
                </button>
              )}
              {canEdit && (
                <Link href="/upload" className="hdr-link">
                  ⤴ Carica dati
                </Link>
              )}
              {isAdmin && (
                <Link href="/admin/users" className="hdr-link">
                  👥 Utenti
                </Link>
              )}
              <LogoutButton className="logout" label="Esci" />
            </div>
          </div>
        </div>
      </header>

      <nav className="tabbar">
        <div className="wrap" id="tabs">
          {TABS.map((t, i) => (
            <button key={i} className={'tab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}>
              <span className="ti">{i + 1}</span>
              {t}
            </button>
          ))}
        </div>
      </nav>

      <FilterBar
        interventi={interventi}
        fornitoriFilter={initial.fornitori_filter}
        filters={filters}
        setFilters={setFilters}
        viewCount={IFs.length}
        viewTot={viewTot}
      />

      <main className="wrap">
        {tab === 0 && <OverviewPanel IFs={IFs} rti={rti} quotaVal={quotaVal} filtersForn={singleForn} />}
        {tab === 1 && (
          <RTIPanel
            IFs={IFs}
            rti={rti}
            quotaVal={quotaVal}
            filtersForn={singleForn}
            rtiSel={rtiSel}
            setRtiSel={setRtiSel}
            editMode={editMode}
            onUpdateRti={onUpdateRti}
          />
        )}
        {tab === 2 && <TimelinePanel timeline={initial.timeline} tlMode={tlMode} setTlMode={setTlMode} />}
        {tab === 3 && <DistribuzionePanel IFs={IFs} seniority={initial.seniority} distSub={distSub} setDistSub={setDistSub} />}
        {tab === 4 && (
          <ModalitaPanel
            modalita={initial.modalita}
            interventi={interventi}
            onDrillMod={(m) => drillTo({ mod: m })}
          />
        )}
        {tab === 5 && <StatoPanel IFs={IFs} onDrillStato={(s) => drillTo({ stato: [s] })} />}
        {tab === 6 && (
          <RegistroPanel
            IFs={IFs}
            canEdit={canEdit}
            onSaveField={onSaveField}
            onOpenEdit={(i) => setDrawer({ open: true, mode: 'edit', initial: i })}
            onOpenNew={() => setDrawer({ open: true, mode: 'new', initial: null })}
            onDelete={onDelete}
            savingIds={savingIds}
            highlightIds={highlightIds}
          />
        )}

        <div className="foot">
          <b>Fonte:</b> aggregatore Modulo 106 e cruscotto revenue — contratto SISS L2 (CIG {initial.meta.cig}), RTI 7-26 a
          mandataria Intellera. I filtri si applicano a tutte le viste; le quote RTI sono contrattuali, mentre
          impegnato/erosione e revenue si ricalcolano sulla selezione. Importi al netto IVA.
        </div>
      </main>

      <EditDrawer
        open={drawer.open}
        mode={drawer.mode}
        initial={drawer.initial}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSave={onSaveDrawer}
      />

      {toast && <div className={'toast' + (toast.bad ? ' bad' : '')}>{toast.msg}</div>}
    </>
  );
}
