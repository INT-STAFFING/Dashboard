'use client';
import React, { useEffect, useState } from 'react';
import type { Intervento, InterventoInput, DocStatus } from '@/lib/types';
import { DOC_OPTIONS } from './StatusSelect';
import { renderNote } from './NotePreview';

const EMPTY: InterventoInput = {
  numero_if: '',
  bdo: '',
  titolo: '',
  ambito: '',
  fornitore: 'Intellera',
  ref_aria: '',
  ref_fornitore: '',
  importo: 0,
  modalita_if: '',
  attivazione: 'NO',
  stato: 'non elaborato',
  has_bo: false,
  pdc: 'nd',
  v_apertura: 'nd',
  v_sal: 'nd',
  bef: 'nd',
  subappalto: false,
  data_assegnazione: '',
  data_inizio: '',
  data_fine: '',
  azione: '',
  note_operative: '',
};

export default function EditDrawer({
  open,
  mode,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  mode: 'edit' | 'new';
  initial: Intervento | null;
  onClose: () => void;
  onSave: (input: InterventoInput, isNew: boolean) => Promise<boolean>;
}) {
  const [form, setForm] = useState<InterventoInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErr(null);
      setForm(initial ? { ...initial } : { ...EMPTY });
    }
  }, [open, initial]);

  if (!open) return null;

  const set = <K extends keyof InterventoInput>(k: K, v: InterventoInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (!form.numero_if || !String(form.numero_if).trim()) return setErr('N° IF obbligatorio');
    if (!form.titolo || !String(form.titolo).trim()) return setErr('Titolo obbligatorio');
    setSaving(true);
    const ok = await onSave({ ...form, importo: Number(form.importo) || 0 }, mode === 'new');
    setSaving(false);
    if (ok) onClose();
    else setErr('Salvataggio non riuscito');
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>{mode === 'new' ? 'Nuovo Intervento di Fornitura' : `Modifica IF ${initial?.numero_if}`}</h3>
          <button className="drawer-x" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <div className="formgrid">
            <label>
              N° IF *
              <input
                type="text"
                value={String(form.numero_if ?? '')}
                disabled={mode === 'edit'}
                onChange={(e) => set('numero_if', e.target.value)}
              />
            </label>
            <label>
              N° BO
              <input type="text" value={String(form.bdo ?? '')} onChange={(e) => set('bdo', e.target.value)} />
            </label>
            <label className="full">
              Titolo Intervento *
              <input type="text" value={String(form.titolo ?? '')} onChange={(e) => set('titolo', e.target.value)} />
            </label>
            <label>
              Ambito
              <input type="text" value={String(form.ambito ?? '')} onChange={(e) => set('ambito', e.target.value)} />
            </label>
            <label>
              Fornitore
              <select value={String(form.fornitore ?? 'Intellera')} onChange={(e) => set('fornitore', e.target.value)}>
                {['Intellera', 'Deloitte', 'Gellify', 'PGMD', 'Accenture'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              Ref. ARIA
              <input type="text" value={String(form.ref_aria ?? '')} onChange={(e) => set('ref_aria', e.target.value)} />
            </label>
            <label>
              Ref. Fornitore
              <input
                type="text"
                value={String(form.ref_fornitore ?? '')}
                onChange={(e) => set('ref_fornitore', e.target.value)}
              />
            </label>
            <label>
              Importo (€)
              <input
                type="number"
                step="0.01"
                value={String(form.importo ?? 0)}
                onChange={(e) => set('importo', Number(e.target.value))}
              />
            </label>
            <label>
              Modalità
              <select value={String(form.modalita_if ?? '')} onChange={(e) => set('modalita_if', e.target.value)}>
                <option value="">—</option>
                {['A corpo', 'A canone', 'A consumo', 'A canone + A corpo'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              Attivazione immediata
              <select value={String(form.attivazione ?? 'NO')} onChange={(e) => set('attivazione', e.target.value)}>
                <option value="SI">SI</option>
                <option value="NO">NO</option>
              </select>
            </label>
            <label>
              Stato BO
              <select value={String(form.stato ?? 'non elaborato')} onChange={(e) => set('stato', e.target.value)}>
                <option value="approvato">approvato</option>
                <option value="non elaborato">non elaborato</option>
              </select>
            </label>
            <label className="chk">
              <input type="checkbox" checked={!!form.has_bo} onChange={(e) => set('has_bo', e.target.checked)} /> BO emesso
            </label>
            {(['pdc', 'v_apertura', 'v_sal', 'bef'] as const).map((k) => (
              <label key={k}>
                {k === 'pdc' ? 'PDC' : k === 'v_apertura' ? 'V. Apertura' : k === 'v_sal' ? 'V. SAL' : 'BEF'}
                <select value={form[k] as DocStatus} onChange={(e) => set(k, e.target.value as DocStatus)}>
                  {DOC_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Data assegnazione
              <input type="date" value={String(form.data_assegnazione ?? '')} onChange={(e) => set('data_assegnazione', e.target.value)} />
            </label>
            <label>
              Data inizio
              <input type="date" value={String(form.data_inizio ?? '')} onChange={(e) => set('data_inizio', e.target.value)} />
            </label>
            <label>
              Data fine
              <input type="date" value={String(form.data_fine ?? '')} onChange={(e) => set('data_fine', e.target.value)} />
            </label>
            <label className="chk">
              <input type="checkbox" checked={!!form.subappalto} onChange={(e) => set('subappalto', e.target.checked)} /> Subappalto
            </label>
            <label className="full">
              Azione richiesta
              <input type="text" value={String(form.azione ?? '')} onChange={(e) => set('azione', e.target.value)} />
            </label>
            <label className="full">
              Note operative <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(supporta **grassetto** ed elenchi “- ”)</span>
              <textarea
                rows={4}
                value={String(form.note_operative ?? '')}
                onChange={(e) => set('note_operative', e.target.value)}
              />
            </label>
          </div>
          {form.note_operative ? (
            <div className="note-preview">
              <div className="note-preview-lab">Anteprima note</div>
              {renderNote(String(form.note_operative))}
            </div>
          ) : null}
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="drawer-foot">
          <button className="addbtn" onClick={submit} disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
          <button className="clearbtn" onClick={onClose} disabled={saving}>
            Annulla
          </button>
        </div>
      </aside>
    </div>
  );
}
