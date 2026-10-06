import { beforeEach, describe, expect, it } from 'vitest';
import {
  createIntervento,
  getIntervento,
  listInterventi,
  softDeleteIntervento,
  updateIntervento,
  upsertInterventiFromUpload,
} from '@/lib/store';
import { makeIf } from './helpers/fixtures';

// Every test starts from an empty in-memory portfolio (no DATABASE_URL in tests).
beforeEach(() => {
  (globalThis as Record<string, unknown>).__ARIA_MEM__ = [];
});

describe('createIntervento', () => {
  it('requires numero_if and titolo', async () => {
    await expect(createIntervento({ titolo: 'x' } as never)).rejects.toThrow(/numero_if/);
    await expect(createIntervento({ numero_if: '1' } as never)).rejects.toThrow(/titolo/);
  });

  it('applies the defaults and marks the record as manually edited', async () => {
    const c = await createIntervento({ numero_if: '1', titolo: 'T' }, 'mario@x.it');
    expect(c).toMatchObject({ fornitore: 'Intellera', attivazione: 'NO', stato: 'non elaborato', has_bo: false, pdc: 'nd', importo: 0, edited_manually: true, last_edited_by: 'mario@x.it' });
    expect(c.rev_mesi).toEqual(Array(12).fill(0));
    expect(await getIntervento('1')).toMatchObject({ titolo: 'T' });
  });

  it('refuses a duplicate numero_if', async () => {
    await createIntervento({ numero_if: '1', titolo: 'T' });
    await expect(createIntervento({ numero_if: '1', titolo: 'T2' })).rejects.toThrow(/già esistente/);
  });

  it('enforces the shared invariants (amount >= 0, end date not before start date)', async () => {
    await expect(createIntervento({ numero_if: '1', titolo: 'T', importo: -1 })).rejects.toThrow(/Importo/);
    await expect(createIntervento({ numero_if: '2', titolo: 'T', data_inizio: '2026-05-01', data_fine: '2026-04-30' })).rejects.toThrow(/data di fine/);
    await expect(createIntervento({ numero_if: '3', titolo: 'T', data_inizio: '2026-05-01', data_fine: '2026-05-01' })).resolves.toBeTruthy();
  });
});

describe('updateIntervento', () => {
  it('returns null for an unknown or deleted IF', async () => {
    expect(await updateIntervento('nope', { titolo: 'x' })).toBeNull();
    await createIntervento({ numero_if: '1', titolo: 'T' });
    await softDeleteIntervento('1');
    expect(await updateIntervento('1', { titolo: 'x' })).toBeNull();
  });

  it('applies the patch, stamps the editor, and can never change the numero_if', async () => {
    await createIntervento({ numero_if: '1', titolo: 'T' });
    const u = await updateIntervento('1', { titolo: 'Nuovo', importo: 99, numero_if: 'HACK' } as never, 'lucia@x.it');
    expect(u).toMatchObject({ numero_if: '1', titolo: 'Nuovo', importo: 99, edited_manually: true, last_edited_by: 'lucia@x.it' });
    expect(await getIntervento('HACK')).toBeNull();
  });

  it('keeps has_bo and stato in lockstep when only one of them is sent', async () => {
    await createIntervento({ numero_if: '1', titolo: 'T' });
    expect(await updateIntervento('1', { stato: 'approvato' })).toMatchObject({ has_bo: true, stato: 'approvato' });
    expect(await updateIntervento('1', { has_bo: false })).toMatchObject({ has_bo: false, stato: 'non elaborato' });
    expect(await updateIntervento('1', { has_bo: true })).toMatchObject({ has_bo: true, stato: 'approvato' });
  });

  it('lets an explicit pair win when both are sent together', async () => {
    await createIntervento({ numero_if: '1', titolo: 'T' });
    expect(await updateIntervento('1', { has_bo: true, stato: 'non elaborato' })).toMatchObject({ has_bo: true, stato: 'non elaborato' });
  });

  it('validates on update too', async () => {
    await createIntervento({ numero_if: '1', titolo: 'T' });
    await expect(updateIntervento('1', { importo: -5 })).rejects.toThrow(/Importo/);
    await expect(updateIntervento('1', { data_inizio: '2026-02-01', data_fine: '2026-01-01' })).rejects.toThrow(/data di fine/);
  });
});

describe('softDeleteIntervento', () => {
  it('hides the record from list and get, and is reported once', async () => {
    await createIntervento({ numero_if: '1', titolo: 'T' });
    expect(await softDeleteIntervento('1')).toBe(true);
    expect(await softDeleteIntervento('1')).toBe(false);
    expect(await getIntervento('1')).toBeNull();
    expect(await listInterventi()).toEqual([]);
    expect(await softDeleteIntervento('missing')).toBe(false);
  });
});

describe('upsertInterventiFromUpload', () => {
  it('inserts new records and reports them', async () => {
    const res = await upsertInterventiFromUpload([makeIf({ numero_if: 'A' }), makeIf({ numero_if: 'B' })]);
    expect(res).toMatchObject({ inserted: 2, updated: 0, skipped: 0, insertedIfs: ['A', 'B'] });
    expect(await listInterventi()).toHaveLength(2);
  });

  it('REGRESSION: a duplicate numero_if inside one file merges onto itself instead of inserting twice', async () => {
    const res = await upsertInterventiFromUpload([makeIf({ numero_if: 'A', titolo: 'Prima', importo: 1 }), makeIf({ numero_if: 'A', titolo: 'Seconda', importo: 2 })]);
    expect(res.inserted).toBe(1);
    expect(await listInterventi()).toHaveLength(1);
    expect(await getIntervento('A')).toMatchObject({ titolo: 'Seconda', importo: 2 });
  });

  describe('merging onto an existing record (an upload file only knows part of an intervento)', () => {
    const seed = (over: Parameters<typeof makeIf>[0] = {}) =>
      upsertInterventiFromUpload([
        makeIf({ numero_if: 'A', bdo: '3300000001', ambito: 'Sviluppo', ref_aria: 'Rossi', modalita_if: 'A corpo', importo: 100, pdc: 'ok', v_apertura: 'ok', has_bo: true, stato: 'approvato', attivazione: 'SI', note_operative: 'nota', ...over }),
      ]);

    it('descriptive fields are only overwritten by a value that is actually present', async () => {
      await seed();
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', bdo: null, ambito: null, ref_aria: '', modalita_if: null, importo: 120 })]);
      expect(await getIntervento('A')).toMatchObject({ bdo: '3300000001', ambito: 'Sviluppo', ref_aria: 'Rossi', modalita_if: 'A corpo', importo: 120 });
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', ambito: 'Governance' })]);
      expect((await getIntervento('A'))?.ambito).toBe('Governance');
    });

    // Revenue and consuntivazione are no longer part of an interventi merge: they are monthly
    // facts per year. Their merge rules (revenue survives an upload that carries none, is replaced
    // by one that does, consuntivazione is kept) are covered in tests/mesiStore.test.ts.

    it('a recognised document status is never downgraded to "nd"; a new known one replaces it', async () => {
      await seed({ pdc: 'ok', v_apertura: 'ok', v_sal: 'nd' });
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', pdc: 'nd', v_apertura: 'ko', v_sal: 'prog' })]);
      expect(await getIntervento('A')).toMatchObject({ pdc: 'ok', v_apertura: 'ko', v_sal: 'prog' });
    });

    it('an emitted BO is never cleared by a source that lacks it; activation only upgrades to SI', async () => {
      await seed({ has_bo: true, stato: 'approvato', attivazione: 'SI' });
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', has_bo: false, stato: 'non elaborato', attivazione: 'NO' })]);
      expect(await getIntervento('A')).toMatchObject({ has_bo: true, stato: 'approvato', attivazione: 'SI' });
    });

    it('operational notes: the incoming note wins when present, otherwise the stored one stays', async () => {
      await seed({ note_operative: 'vecchia' });
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', note_operative: null })]);
      expect((await getIntervento('A'))?.note_operative).toBe('vecchia');
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', note_operative: 'nuova' })]);
      expect((await getIntervento('A'))?.note_operative).toBe('nuova');
    });
  });

  describe('manually edited records', () => {
    it('are skipped by an upload and left untouched', async () => {
      await createIntervento({ numero_if: 'M', titolo: 'Mia', importo: 10 });
      const res = await upsertInterventiFromUpload([makeIf({ numero_if: 'M', titolo: 'Da file', importo: 999 })]);
      expect(res).toMatchObject({ inserted: 0, updated: 0, skipped: 1, skippedIfs: ['M'] });
      expect(await getIntervento('M')).toMatchObject({ titolo: 'Mia', importo: 10, edited_manually: true });
    });

    it('are overwritten with force=true, which also clears the manual flag', async () => {
      await createIntervento({ numero_if: 'M', titolo: 'Mia', importo: 10 });
      const res = await upsertInterventiFromUpload([makeIf({ numero_if: 'M', titolo: 'Da file', importo: 999 })], true);
      expect(res).toMatchObject({ updated: 1, skipped: 0 });
      expect(await getIntervento('M')).toMatchObject({ titolo: 'Da file', importo: 999, edited_manually: false });
    });
  });

  it('an upload brings a soft-deleted record back to life', async () => {
    await upsertInterventiFromUpload([makeIf({ numero_if: 'A', titolo: 'Vecchio' })]);
    await softDeleteIntervento('A');
    expect(await listInterventi()).toEqual([]);
    const res = await upsertInterventiFromUpload([makeIf({ numero_if: 'A', titolo: 'Ritorno' })]);
    expect(res.updated).toBe(1);
    expect(await getIntervento('A')).toMatchObject({ titolo: 'Ritorno' });
  });
});
