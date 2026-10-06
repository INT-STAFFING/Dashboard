// Audit trail for the admin SQL console. The console can run any statement on
// any table, so every execution leaves a row: who, what, when, outcome.
//
// The row is written BEFORE the statement runs (beginAudit) and the caller must
// not execute it if that write fails — otherwise a statement could run without
// leaving a trace. finishAudit then records the outcome on a best-effort basis.
//
// Limit: the log lives in the same database, so an admin can still edit it from
// the same console. It records what was done; it is not tamper-proof.
import { eq } from 'drizzle-orm';
import { getDb, ensureSchema } from './db';
import { admin_audit_log } from './schema';

const MAX_STATEMENT_CHARS = 20_000;

export type AuditActor = { id: number | null; email: string | null };

export async function beginAudit(actor: AuditActor, statement: string, action = 'sql'): Promise<number> {
  await ensureSchema();
  const inserted = await getDb()
    .insert(admin_audit_log)
    .values({
      user_id: actor.id,
      user_email: actor.email,
      action,
      statement: statement.length > MAX_STATEMENT_CHARS ? statement.slice(0, MAX_STATEMENT_CHARS) + '…[troncato]' : statement,
      status: 'started',
    })
    .returning({ id: admin_audit_log.id });
  return inserted[0].id;
}

export async function finishAudit(
  id: number,
  outcome: { ok: boolean; rowCount?: number; durationMs?: number; error?: string },
): Promise<void> {
  try {
    await getDb()
      .update(admin_audit_log)
      .set({
        status: outcome.ok ? 'ok' : 'error',
        row_count: outcome.rowCount ?? null,
        duration_ms: outcome.durationMs ?? null,
        error: outcome.error ? outcome.error.slice(0, 2000) : null,
      })
      .where(eq(admin_audit_log.id, id));
  } catch (e) {
    console.error('[admin-audit] could not record the outcome of audit row', id, e);
  }
}
