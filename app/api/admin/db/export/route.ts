import * as XLSX from 'xlsx';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { collectAllTables } from '@/lib/dbExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Excel sheet names are capped at 31 chars and can't contain []:*?/\ — sanitise
// table names and disambiguate collisions so every table lands on its own sheet.
function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'tabella';
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = `_${i++}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

// Flatten a value to something Excel can render: JSON columns (jsonb/arrays)
// become their JSON text, dates/timestamps stay as-is (SheetJS handles Date),
// everything else passes through. null/undefined become an empty cell.
function cell(v: unknown): string | number | boolean | Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

// GET -> .xlsx workbook with one sheet per table, each containing that table's
// columns (header row) and full contents. The data is materialized into the
// file (no external/database link). Works with a Neon database or the
// zero-config in-memory store.
export async function GET() {
  if (!isAdmin(await getSessionUser())) {
    return new Response(JSON.stringify({ ok: false, error: 'Riservato agli amministratori' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const tables = await collectAllTables();

    const wb = XLSX.utils.book_new();
    const used = new Set<string>();
    // Index sheet: overview of every exported table and its row count.
    const summary: (string | number)[][] = [['Tabella', 'Colonne', 'Righe']];

    for (const { table, columns, rows } of tables) {
      const aoa: (string | number | boolean | Date | null)[][] = [columns];
      for (const row of rows) {
        aoa.push(columns.map((c) => cell(row[c])));
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, sheetName(table, used));
      summary.push([table, columns.length, rows.length]);
    }

    // Prepend the index sheet so it opens first.
    const summaryWs = XLSX.utils.aoa_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, summaryWs, '_Indice');
    wb.SheetNames.unshift(wb.SheetNames.pop() as string);

    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
    // Copy into a plain ArrayBuffer so the Blob body is typed against
    // ArrayBuffer (not the wider ArrayBufferLike SheetJS returns).
    const ab = new ArrayBuffer(out.byteLength);
    new Uint8Array(ab).set(out);
    const stamp = new Date().toISOString().slice(0, 10);
    const body = new Blob([ab], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Database_ARIA_SISS_${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Errore export database' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
