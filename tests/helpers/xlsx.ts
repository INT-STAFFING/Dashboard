import * as XLSX from 'xlsx';

// Real .xlsx files generated in memory (written with SheetJS, read back through the
// same readWorkbook() the app uses), so parser tests exercise the actual parsing
// path — including the cellDates coercion behind several past bugs — without
// shipping any customer data.
export type Cell = string | number | Date | null | { v: number; z: string };

export function workbook(sheets: Record<string, Cell[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const plain = rows.map((r) => r.map((c) => (c && typeof c === 'object' && !(c instanceof Date) ? null : c)));
    const ws = XLSX.utils.aoa_to_sheet(plain, { cellDates: true });
    // Cells that must be numeric but carry a date number-format (the "IF as a date" case).
    rows.forEach((r, ri) =>
      r.forEach((c, ci) => {
        if (c && typeof c === 'object' && !(c instanceof Date)) {
          ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = { t: 'n', v: c.v, z: c.z };
        }
      }),
    );
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}
