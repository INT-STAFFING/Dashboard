import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applySchema } from '@/lib/db';
import { getMeta, getQuotaVal, getRtiConfig, quotaValFromRti, updateMeta, updateRtiConfig } from '@/lib/config';
import { getModalita, getSeniority, getTimeline, setSeniority, setTimeline } from '@/lib/portfolio';
import { listAllRisorse, listRisorse, replaceRisorse } from '@/lib/risorse';
import { getSetting, getSettingsBulk, setSetting } from '@/lib/settings';
import { getMultiYearTimeline, listTimelineMonths, setTimelineYear } from '@/lib/timelineStore';
import { listAllReportBdo, persistReportBdoFromUpload } from '@/lib/reportBdoStore';
import { listAllReportRdi, persistReportRdiFromUpload } from '@/lib/reportRdiStore';
import { listAllPdc, listPdcByBdo, persistReportPdcFromUpload } from '@/lib/reportPdcStore';
import { SEED_META, SEED_MODALITA, SEED_QUOTA_VAL, SEED_RTI, SEED_SENIORITY, SEED_TIMELINE } from '@/lib/seed';
import type { ReportBdoRecord, ReportPdcRecord, ReportRdiRecord } from '@/lib/types';
import { createTestDb } from './helpers/pglite';

// Same scenarios on the in-memory store and on a real Postgres (PGlite) built by
// the production bootstrap.
const state = vi.hoisted(() => ({ hasDB: false, db: null as unknown }));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, get hasDB() { return state.hasDB; }, getDb: () => state.db, ensureSchema: async () => {} };
});

const MEM_KEYS = ['__ARIA_RIS__', '__ARIA_TL_MY__', '__ARIA_REPORT_BDO__', '__ARIA_REPORT_RDI__', '__ARIA_REPORT_PDC__', '__ARIA_CFG__'];
const m = (...v: number[]): number[] => [...v, ...Array(12 - v.length).fill(0)];

const bdoRec = (o: Partial<ReportBdoRecord> = {}): ReportBdoRecord => ({
  num_bdo: '3300000001', descrizione_bdo: 'd', nome_file_pif_if: null, descrizione_pif_if: null, codifica_documento: null, stato_documento: 'Approvato', divisione: null,
  centro_costo: null, ultima_pif_approvata: null, data_caricamento: '2026-01-05', utente_caricamento: null, fornitore: null, roi: null, data_invio_roi: null,
  data_approvazione_roi: null, data_rifiuto_roi: null, pmo: null, data_invio_pmo: null, data_approvazione_pmo: null, data_rifiuto_pmo: null, ctrm: null,
  data_invio_ctrm: null, data_approvazione_ctrm: null, data_rifiuto_ctrm: null, versione_corrente: '1', data_versione_corrente: null, data_decorrenza: null, ...o,
});
const rdiRec = (o: Partial<ReportRdiRecord> = {}): ReportRdiRecord => ({
  numero_rdi: '55001', descrizione_rdi: 'r', nome_file_pif_if: null, codifica_documento: null, stato_documento: 'Bozza', divisione: null, centro_costo: null,
  ultima_pif_approvata: null, descrizione_pif_if: null, data_caricamento: '2026-02-01', utente_caricamento: null, fornitore: null, roi: null, data_invio_roi: null,
  data_rifiuto_roi: null, data_approvazione_roi: null, ...o,
});
const pdcRec = (o: Partial<ReportPdcRecord> = {}): ReportPdcRecord => ({
  num_bdo: '3300000001', posizione_bdo: '10', descrizione_posizione: 'p', importo_posizione: 100.5, codice_pdc: null, periodo_pdc: '2026-01', data_creazione: null,
  utente_caricamento: null, codifica_documento: null, stato_pdc: 'Approvata', divisione: null, centro_costo: null, fornitore_rti: null, roi: null, data_invio_roi: null,
  data_rifiuto_roi: null, data_approvazione_roi: null, fornitore_prestazione: null, service_line: null, tipo_fornitura: null, rdi: null, posizione_rdi: null,
  subappalto: null, subappaltatore: null, costo_subappalto: null, ...o,
});

let pg: PGlite;

describe.each(['memory', 'database'] as const)('%s backend', (backend) => {
  const isDb = backend === 'database';

  beforeAll(async () => {
    if (!isDb) return;
    const t = await createTestDb();
    pg = t.pg;
    state.db = t.db;
    state.hasDB = true;
    await applySchema(t.db as never);
  });
  afterAll(async () => {
    if (isDb) await pg.close();
  });
  beforeEach(async () => {
    state.hasDB = isDb;
    const g = globalThis as Record<string, unknown>;
    for (const k of MEM_KEYS) delete g[k];
    if (isDb) await pg.exec(`TRUNCATE if_risorse, timeline_mensile, report_bdo, report_rdi, report_pdc RESTART IDENTITY; DELETE FROM app_config WHERE key <> 'schema_version'`);
  });

  describe('settings', () => {
    it('returns the seed until something is saved, and never lets callers mutate it', async () => {
      const a = await getSetting('k', { n: 1 });
      a.n = 99;
      expect(await getSetting('k', { n: 1 })).toEqual({ n: 1 });
    });

    it('saves and reads back a value', async () => {
      expect(await setSetting('k', { n: 2 })).toEqual({ n: 2 });
      expect(await getSetting('k', { n: 1 })).toEqual({ n: 2 });
      if (isDb) {
        const r = await pg.query<{ value: { n: number } }>(`select value from app_config where key = 'k'`);
        expect(r.rows[0].value).toEqual({ n: 2 });
      }
    });

    it('overwrites on a second save (one row per key)', async () => {
      await setSetting('k', { n: 1 });
      await setSetting('k', { n: 2 });
      expect(await getSetting('k', { n: 0 })).toEqual({ n: 2 });
      if (isDb) expect((await pg.query(`select 1 from app_config where key = 'k'`)).rows).toHaveLength(1);
    });

    it('reads several keys at once: stored values win, the others fall back to their seeds', async () => {
      await setSetting('a', 'stored');
      expect(await getSettingsBulk({ a: 'seed-a', b: 'seed-b' })).toEqual({ a: 'stored', b: 'seed-b' });
    });
  });

  describe('RTI configuration', () => {
    it('starts from the baseline and derives the quota map from it', async () => {
      expect(await getRtiConfig()).toEqual(SEED_RTI);
      const q = await getQuotaVal();
      expect(q).toMatchObject(SEED_QUOTA_VAL);
      expect(quotaValFromRti(SEED_RTI)).toEqual(q);
    });

    it('recomputes every partner quota when the ceiling changes', async () => {
      const cfg = await updateRtiConfig({ massimale_totale: 2_000_000 });
      expect(cfg.ceiling).toBe(2_000_000);
      for (const p of cfg.partners) expect(p.quota).toBeCloseTo(2_000_000 * p.pct, 4);
      expect((await getRtiConfig()).ceiling).toBe(2_000_000);
    });

    it('applies the legacy Intellera/Deloitte percentages (0..100) to their partners only', async () => {
      const before = await getRtiConfig();
      const cfg = await updateRtiConfig({ quota_intellera_pct: 40 });
      expect(cfg.partners.find((p) => p.name === 'Intellera')!.pct).toBeCloseTo(0.4, 6);
      const others = cfg.partners.filter((p) => p.name !== 'Intellera');
      expect(others.map((p) => p.pct)).toEqual(before.partners.filter((p) => p.name !== 'Intellera').map((p) => p.pct));
    });

    it('replaces the whole split when partners are given, keeping each partner\'s committed amount', async () => {
      const before = await getRtiConfig();
      const intellera = before.partners.find((p) => p.name === 'Intellera')!;
      const cfg = await updateRtiConfig({ partners: [{ name: 'Intellera', pct: 0.7 }, { name: 'Nuovo', pct: 0.3 }] });
      expect(cfg.partners.map((p) => p.name)).toEqual(['Intellera', 'Nuovo']);
      expect(cfg.partners[0]).toMatchObject({ pct: 0.7, impegnato: intellera.impegnato });
      expect(cfg.partners[1]).toMatchObject({ pct: 0.3, impegnato: 0 });
      expect(cfg.partners[1].quota).toBeCloseTo(cfg.ceiling * 0.3, 4);
    });

    it('rejects invalid values and changes nothing', async () => {
      await expect(updateRtiConfig({ massimale_totale: -1 })).rejects.toThrow(/Massimale/);
      await expect(updateRtiConfig({ massimale_totale: NaN })).rejects.toThrow(/Massimale/);
      await expect(updateRtiConfig({ quota_intellera_pct: 101 })).rejects.toThrow(/Intellera/);
      await expect(updateRtiConfig({ quota_deloitte_pct: -5 })).rejects.toThrow(/Deloitte/);
      await expect(updateRtiConfig({ partners: [{ name: 'X', pct: 1.5 }] })).rejects.toThrow(/"X"/);
      expect(await getRtiConfig()).toEqual(SEED_RTI);
    });

    it('merges contract metadata edits over what is stored', async () => {
      expect(await getMeta()).toEqual(SEED_META);
      const meta = await updateMeta({ cig: 'NUOVO-CIG' });
      expect(meta).toEqual({ ...SEED_META, cig: 'NUOVO-CIG' });
      expect(await getMeta()).toEqual(meta);
    });
  });

  describe('portfolio aggregates', () => {
    it('starts from the baseline', async () => {
      expect(await getSeniority()).toEqual(SEED_SENIORITY);
      expect(await getModalita()).toEqual(SEED_MODALITA);
      expect(await getTimeline()).toEqual(SEED_TIMELINE);
    });

    it('REGRESSION: an empty seniority list (an upload with no GdL sheet) never wipes the stored one', async () => {
      const custom = [{ figura: 'X', code: 'X', gg: 1, tariffa: null }];
      await setSeniority(custom);
      expect(await setSeniority([])).toEqual(custom);
      expect(await getSeniority()).toEqual(custom);
    });

    it('saves the legacy timeline setting', async () => {
      const t = { ...SEED_TIMELINE, anno: 2031 };
      await setTimeline(t);
      expect((await getTimeline()).anno).toBe(2031);
    });
  });

  describe('risorse (per-IF resource allocation)', () => {
    const row = (o: Record<string, unknown> = {}) => ({ numero_if: 'A', figura: 'PM', sigla: 'PM', gruppo: 'G1', gg: 10, tariffa_giornaliera: 500, ...o });

    it('replaces the whole set of an IF and leaves the others alone', async () => {
      await replaceRisorse('A', [row(), row({ figura: 'Dev' })]);
      await replaceRisorse('B', [row({ numero_if: 'B' })]);
      expect(await listRisorse('A')).toHaveLength(2);
      await replaceRisorse('A', [row({ figura: 'Solo' })]);
      expect((await listRisorse('A')).map((r) => r.figura)).toEqual(['Solo']);
      expect(await listRisorse('B')).toHaveLength(1);
      expect(await listAllRisorse()).toHaveLength(2);
    });

    it('normalises blanks to null and numbers to numbers', async () => {
      const [r] = await replaceRisorse('A', [{ numero_if: 'A', figura: null, sigla: undefined as unknown as null, gruppo: '', gg: '12.5' as unknown as number, tariffa_giornaliera: '' as unknown as number }]);
      expect(r).toMatchObject({ numero_if: 'A', figura: null, sigla: null, gg: 12.5, tariffa_giornaliera: null });
    });

    it('saving an empty set clears the IF', async () => {
      await replaceRisorse('A', [row()]);
      expect(await replaceRisorse('A', [])).toEqual([]);
      expect(await listRisorse('A')).toEqual([]);
    });

    it('an IF with nothing saved has no resources', async () => {
      expect(await listRisorse('nope')).toEqual([]);
    });
  });

  describe('global timeline (timeline_mensile)', () => {
    it('stores a full year, replacing it on every save', async () => {
      await setTimelineYear(2026, m(1, 2, 3), m(0, 1));
      await setTimelineYear(2026, m(9), m());
      const months = (await listTimelineMonths()).filter((x) => x.anno === 2026);
      expect(months).toHaveLength(12);
      expect(months[0]).toEqual({ anno: 2026, mese: 1, revenue: 9, consuntivato: 0 });
      expect(months.reduce((s, x) => s + x.revenue, 0)).toBe(9);
    });

    it('keeps the years independent and lists them ascending', async () => {
      await setTimelineYear(2027, m(5), m());
      await setTimelineYear(2025, m(7), m());
      const t = await getMultiYearTimeline();
      expect(t.years).toEqual([2025, 2027]);
      expect(t.months).toHaveLength(24);
      expect(t.months.find((x) => x.anno === 2025 && x.mese === 1)!.revenue).toBe(7);
    });

    it('normalises sloppy input to 12 finite numbers', async () => {
      await setTimelineYear(2026, [1, 'x', NaN] as unknown as number[], null as unknown as number[]);
      const months = await listTimelineMonths();
      expect(months.map((x) => x.revenue).slice(0, 3)).toEqual([1, 0, 0]);
    });
  });

  describe('REPORT Bdo snapshot', () => {
    it('only enriches BDOs already in the portfolio and reports the rest as ignored', async () => {
      const res = await persistReportBdoFromUpload([bdoRec({ num_bdo: 'K1' }), bdoRec({ num_bdo: 'UNKNOWN' })], new Set(['K1']));
      expect(res).toEqual({ saved: 1, ignored: 1 });
      expect((await listAllReportBdo()).map((r) => r.num_bdo)).toEqual(['K1']);
    });

    it('upserts: a re-upload updates the row instead of duplicating it', async () => {
      const known = new Set(['K1']);
      await persistReportBdoFromUpload([bdoRec({ num_bdo: 'K1', stato_documento: 'Bozza' })], known);
      await persistReportBdoFromUpload([bdoRec({ num_bdo: 'K1', stato_documento: 'Approvato', data_decorrenza: '2026-03-01' })], known);
      const all = await listAllReportBdo();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ stato_documento: 'Approvato', data_decorrenza: '2026-03-01' });
    });

    it('lists clean records (no database id or timestamp)', async () => {
      await persistReportBdoFromUpload([bdoRec({ num_bdo: 'K1' })], new Set(['K1']));
      const [r] = await listAllReportBdo();
      expect(r).not.toHaveProperty('id');
      expect(r).not.toHaveProperty('updated_at');
      expect(r.num_bdo).toBe('K1');
    });
  });

  describe('REPORT Rdi snapshot', () => {
    it('saves every row and upserts by RDI number', async () => {
      expect(await persistReportRdiFromUpload([rdiRec({ numero_rdi: '1' }), rdiRec({ numero_rdi: '2' })])).toEqual({ saved: 2 });
      await persistReportRdiFromUpload([rdiRec({ numero_rdi: '1', stato_documento: 'Approvato' })]);
      const all = await listAllReportRdi();
      expect(all).toHaveLength(2);
      expect(all.find((r) => r.numero_rdi === '1')!.stato_documento).toBe('Approvato');
      expect(all[0]).not.toHaveProperty('id');
    });

    it('an empty upload changes nothing', async () => {
      expect(await persistReportRdiFromUpload([])).toEqual({ saved: 0 });
      expect(await listAllReportRdi()).toEqual([]);
    });
  });

  describe('REPORT Pdc snapshot', () => {
    const known = new Set(['B1', 'B2']);

    it('keeps only known BDOs and round-trips the amounts as numbers', async () => {
      const res = await persistReportPdcFromUpload([pdcRec({ num_bdo: 'B1', costo_subappalto: 20.25 }), pdcRec({ num_bdo: 'ZZ' })], known);
      expect(res).toEqual({ saved: 1, ignored: 1 });
      const [r] = await listPdcByBdo('B1');
      expect(r).toMatchObject({ importo_posizione: 100.5, costo_subappalto: 20.25 });
      expect(r).not.toHaveProperty('id');
      expect(await listPdcByBdo('ZZ')).toEqual([]);
      expect(await listPdcByBdo('')).toEqual([]);
    });

    it('REGRESSION: re-uploading the same positions does not duplicate them, and updates in place', async () => {
      const upload = [pdcRec({ num_bdo: 'B1', posizione_bdo: '10', periodo_pdc: '2026-01' }), pdcRec({ num_bdo: 'B1', posizione_bdo: '10', periodo_pdc: '2026-02' })];
      await persistReportPdcFromUpload(upload, known);
      await persistReportPdcFromUpload(upload.map((r) => ({ ...r, stato_pdc: 'Chiusa' })), known);
      const rows = await listPdcByBdo('B1');
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.stato_pdc === 'Chiusa')).toBe(true);
    });

    it('drops periods that are no longer in the new upload for that BDO, keeping other BDOs', async () => {
      await persistReportPdcFromUpload(
        [pdcRec({ num_bdo: 'B1', periodo_pdc: '2026-01' }), pdcRec({ num_bdo: 'B1', periodo_pdc: '2026-02' }), pdcRec({ num_bdo: 'B2', periodo_pdc: '2026-01' })],
        known,
      );
      await persistReportPdcFromUpload([pdcRec({ num_bdo: 'B1', periodo_pdc: '2026-02' })], known);
      expect((await listPdcByBdo('B1')).map((r) => r.periodo_pdc)).toEqual(['2026-02']);
      expect(await listPdcByBdo('B2')).toHaveLength(1);
      expect(await listAllPdc()).toHaveLength(2);
    });

    it('rows without a full natural key are replaced wholesale for their BDO', async () => {
      await persistReportPdcFromUpload([pdcRec({ num_bdo: 'B1', posizione_bdo: null }), pdcRec({ num_bdo: 'B1', posizione_bdo: null, descrizione_posizione: 'altra' })], known);
      expect(await listPdcByBdo('B1')).toHaveLength(2);
      await persistReportPdcFromUpload([pdcRec({ num_bdo: 'B1', posizione_bdo: null, descrizione_posizione: 'ultima' })], known);
      const rows = await listPdcByBdo('B1');
      expect(rows).toHaveLength(1);
      expect(rows[0].descrizione_posizione).toBe('ultima');
    });
  });
});
