// Raccolta dei dati per l'export completo del database in Excel.
//
// Restituisce, per ogni tabella, le colonne e TUTTE le righe con i valori
// materializzati (nessun collegamento esterno: i dati finiscono dentro il file
// scaricato). Funziona in entrambe le modalità di persistenza dell'app:
//   - con database Neon configurato  -> introspezione dello schema `public`
//     e SELECT * per ogni tabella;
//   - senza database (store in-memory, default zero-config) -> lettura dagli
//     stessi store che alimentano la dashboard, così il file contiene esattamente
//     i dati visualizzati.
import { sql } from 'drizzle-orm';
import { getDb, hasDB } from './db';
import { listInterventi } from './store';
import { listAllBef } from './befStore';
import { listAllRisorse } from './risorse';
import { listTimelineMonths } from './timelineStore';
import { getSeniority, getModalita, getTimeline } from './portfolio';
import { getRtiConfig, getMeta } from './config';
import { listUsers } from './users';
import { listAllReportBdo } from './reportBdoStore';
import { listAllReportRdi } from './reportRdiStore';
import { listAllPdc } from './reportPdcStore';
import { listAllVerbaliApertura } from './verbaliAperturaStore';
import { listAllVerbaliSal } from './verbaliSalStore';

export type TableDump = {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

// Union of the keys seen across the rows, first-seen order preserved. Falls
// back to the provided hint (schema column names) when there are no rows, so
// even an empty table still exports its structure.
function deriveColumns(rows: Record<string, unknown>[], hint: string[] = []): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols.length ? cols : hint;
}

function dump(table: string, rows: Record<string, unknown>[], hint: string[] = []): TableDump {
  return { table, columns: deriveColumns(rows, hint), rows };
}

// --- DB mode: introspect the public schema and read every table -------------
async function collectFromDb(): Promise<TableDump[]> {
  const db = getDb();
  const tablesRes = await db.execute(sql.raw(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `));
  const tableNames = (tablesRes.rows as Array<{ table_name: string }>).map((r) => r.table_name);

  const out: TableDump[] = [];
  for (const table of tableNames) {
    const colsRes = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}
          ORDER BY ordinal_position`,
    );
    const columns = (colsRes.rows as Array<{ column_name: string }>).map((c) => c.column_name);
    // Table name comes from pg_class -> a real identifier; quote defensively.
    const ident = '"' + table.replace(/"/g, '""') + '"';
    const dataRes = await db.execute(sql.raw(`SELECT * FROM ${ident}`));
    const rows = dataRes.rows as Array<Record<string, unknown>>;
    out.push({ table, columns: columns.length ? columns : deriveColumns(rows), rows });
  }
  return out;
}

// --- In-memory mode: read the same stores the dashboard uses ----------------
async function collectFromMemory(): Promise<TableDump[]> {
  const [
    interventi,
    bef,
    risorse,
    timeline,
    seniority,
    modalita,
    rti,
    meta,
    timelineCfg,
    users,
    reportBdo,
    reportRdi,
    reportPdc,
    verbaliApertura,
    verbaliSal,
  ] = await Promise.all([
    listInterventi(),
    listAllBef(),
    listAllRisorse(),
    listTimelineMonths(),
    getSeniority(),
    getModalita(),
    getRtiConfig(),
    getMeta(),
    getTimeline(),
    listUsers(),
    listAllReportBdo(),
    listAllReportRdi(),
    listAllPdc(),
    listAllVerbaliApertura(),
    listAllVerbaliSal(),
  ]);

  // app_config è una tabella chiave/valore: ricomponiamo le righe come le
  // memorizza l'app (una riga JSON per chiave di configurazione).
  const appConfig: Record<string, unknown>[] = [
    { key: 'rti', value: rti },
    { key: 'meta', value: meta },
    { key: 'seniority', value: seniority },
    { key: 'modalita', value: modalita },
    { key: 'timeline', value: timelineCfg },
  ];

  return [
    dump('interventi', interventi as unknown as Record<string, unknown>[]),
    dump('bef_records', bef as unknown as Record<string, unknown>[]),
    dump('if_risorse', risorse as unknown as Record<string, unknown>[]),
    dump('timeline_mensile', timeline as unknown as Record<string, unknown>[]),
    dump('tariffe', seniority as unknown as Record<string, unknown>[]),
    dump('report_bdo', reportBdo as unknown as Record<string, unknown>[]),
    dump('report_rdi', reportRdi as unknown as Record<string, unknown>[]),
    dump('report_pdc', reportPdc as unknown as Record<string, unknown>[]),
    dump('verbali_apertura', verbaliApertura as unknown as Record<string, unknown>[]),
    dump('verbali_sal', verbaliSal as unknown as Record<string, unknown>[]),
    dump('users', users as unknown as Record<string, unknown>[]),
    dump('app_config', appConfig, ['key', 'value']),
  ];
}

// Every table with its full contents, materialized. Empty tables are still
// returned (so the workbook lists them). Ordered alphabetically by table name.
export async function collectAllTables(): Promise<TableDump[]> {
  const tables = hasDB ? await collectFromDb() : await collectFromMemory();
  return tables.sort((a, b) => a.table.localeCompare(b.table));
}
