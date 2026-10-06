import { describe, it, expect } from 'vitest';
import { FORMULA_CATALOG, buildFormulaCsv, type FormulaRow } from '@/lib/formulaCatalog';

describe('formulaCatalog', () => {
  it('ogni riga ha tutti i campi valorizzati', () => {
    expect(FORMULA_CATALOG.length).toBeGreaterThan(20);
    for (const r of FORMULA_CATALOG) {
      for (const k of ['pagina', 'sezione', 'elemento', 'formula', 'spiegazione', 'sorgenti'] as const) {
        expect(typeof r[k], `${r.elemento}.${k}`).toBe('string');
        expect(r[k].trim().length, `${r.elemento}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('non ha elementi duplicati nella stessa pagina/sezione', () => {
    const keys = FORMULA_CATALOG.map((r) => `${r.pagina}|${r.sezione}|${r.elemento}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('regressione: nessun riferimento all\'anno fisso 2026 o al campo rimosso revenue_2026', () => {
    const text = FORMULA_CATALOG.map((r) => Object.values(r).join(' ')).join('\n');
    expect(text).not.toMatch(/revenue_2026/);
    expect(text).not.toMatch(/\b2026\b/);
  });

  it('CSV: BOM, intestazione, una riga per voce, virgolette raddoppiate', () => {
    const rows: FormulaRow[] = [
      { pagina: 'P', sezione: 'S', elemento: 'E "x"', formula: 'a;b', spiegazione: 'riga\ndue', sorgenti: 'src' },
    ];
    const csv = buildFormulaCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Pagina";"Sezione"');
    expect(csv).toContain('"E ""x"""');
    expect(csv).toContain('"a;b"');
    expect(csv.split('\r\n').at(-1)).toContain('"P";"S"');
  });

  it('CSV completo: intestazione + intro + tutte le righe', () => {
    const lines = buildFormulaCsv().split('\r\n');
    expect(lines.length).toBe(FORMULA_CATALOG.length + 5);
  });
});
