import { NextResponse } from 'next/server';
import { parseFile, type FileKind, type ParseOutput } from '@/lib/parsers';
import { upsertInterventiFromUpload } from '@/lib/store';
import { setSeniority } from '@/lib/portfolio';
import { getSessionUser, canEdit } from '@/lib/auth';
import type { DocStatus, Intervento } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: Request): boolean {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret) return true; // no secret configured -> rely on edit permission
  const header = req.headers.get('x-upload-secret') || '';
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || header;
  return token === secret;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const docStatus = (v: unknown): DocStatus =>
  v === 'ok' || v === 'ko' || v === 'prog' ? v : 'nd';
const sval = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

// Normalize an untrusted intervento object (from a client-side parse) into the
// canonical shape before it reaches the store. Only known fields are kept.
function normalizeIntervento(raw: unknown): Intervento | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const numero_if = sval(r.numero_if);
  const titolo = sval(r.titolo);
  if (!numero_if || !titolo) return null;
  const mesi = Array.isArray(r.rev_mesi) ? r.rev_mesi.map(num) : [];
  const rev_mesi = Array.from({ length: 12 }, (_, i) => mesi[i] ?? 0);
  return {
    numero_if,
    bdo: sval(r.bdo),
    titolo,
    ambito: sval(r.ambito),
    fornitore: sval(r.fornitore) ?? 'Intellera',
    ref_aria: sval(r.ref_aria),
    ref_fornitore: sval(r.ref_fornitore),
    importo: num(r.importo),
    revenue_2026: num(r.revenue_2026),
    rev_mesi,
    modalita_if: sval(r.modalita_if),
    attivazione: r.attivazione === 'SI' ? 'SI' : 'NO',
    stato: sval(r.stato) ?? 'non elaborato',
    has_bo: Boolean(r.has_bo),
    pdc: docStatus(r.pdc),
    v_apertura: docStatus(r.v_apertura),
    v_sal: docStatus(r.v_sal),
    bef: docStatus(r.bef),
    subappalto: Boolean(r.subappalto),
    subappaltatore: Array.isArray(r.subappaltatore)
      ? r.subappaltatore.map(String).filter(Boolean)
      : [],
    costo_subappalto: num(r.costo_subappalto),
    data_assegnazione: sval(r.data_assegnazione),
    data_inizio: sval(r.data_inizio),
    data_fine: sval(r.data_fine),
    azione: sval(r.azione),
    note_operative: sval(r.note_operative),
    edited_manually: false,
    last_edited_at: null,
    last_edited_by: null,
  };
}

// Apply a parsed payload (from either the server-side parser or a client-side
// parse) to the store and return the upload summary.
async function applyParsed(parsed: ParseOutput, force: boolean) {
  const errors: string[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  if (parsed.interventi && parsed.interventi.length) {
    const res = await upsertInterventiFromUpload(parsed.interventi, force);
    inserted += res.inserted;
    updated += res.updated;
    skipped += res.skipped;
  }
  if (parsed.seniority && parsed.seniority.length) {
    setSeniority(parsed.seniority);
  }
  if (parsed.kind === 'bef') {
    errors.push(`BEF: ${parsed.bef?.length ?? 0} righe lette (non persistite)`);
  }
  if (parsed.kind === 'chiusura') {
    errors.push(`Chiusura: ${parsed.chiusura?.length ?? 0} righe lette (non persistite)`);
  }
  return { inserted, updated, skipped, seniority_rows: parsed.seniority?.length ?? 0, errors };
}

export async function POST(req: Request) {
  // Upload mutates data: require an account with edit permission (ADMIN/USERPLUS).
  if (!canEdit(await getSessionUser())) {
    return NextResponse.json(
      { ok: false, error: 'Permessi di modifica non concessi' },
      { status: 403 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'Non autorizzato' }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';
  const contentType = req.headers.get('content-type') || '';

  // --- JSON path: the workbook was parsed in the browser and only the
  // extracted records are sent. Avoids the platform request-body size limit
  // that blocks large (>4.5MB) raw spreadsheet uploads to serverless functions.
  if (contentType.includes('application/json')) {
    let body: { kind?: FileKind; interventi?: unknown[]; seniority?: ParseOutput['seniority']; filename?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
    }
    const kind = (body.kind ?? 'unknown') as FileKind;
    if (kind === 'unknown') {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Tipo file non riconosciuto. Il nome deve contenere Dashboard / IF_ARIA / BEF / Chiusura / Aggregatore.',
        },
        { status: 422 },
      );
    }
    const interventi = (body.interventi ?? [])
      .map(normalizeIntervento)
      .filter((i): i is Intervento => i !== null);
    const parsed: ParseOutput = { kind, interventi, seniority: body.seniority };
    const summary = await applyParsed(parsed, force);
    return NextResponse.json({ ok: true, kind, filename: body.filename ?? null, force, ...summary });
  }

  // --- Multipart path: small files parsed server-side (kept for compatibility).
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'multipart/form-data o application/json atteso' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ ok: false, error: 'Campo "file" mancante' }, { status: 400 });
  }

  const filename = (file as File).name;
  const buf = Buffer.from(await (file as File).arrayBuffer());

  let parsed;
  try {
    parsed = parseFile(filename, buf);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'Parsing fallito: ' + (e instanceof Error ? e.message : '') },
      { status: 422 },
    );
  }

  if (parsed.kind === 'unknown') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Tipo file non riconosciuto. Il nome deve contenere Dashboard / IF_ARIA / BEF / Chiusura / Aggregatore.',
      },
      { status: 422 },
    );
  }

  const summary = await applyParsed(parsed, force);
  return NextResponse.json({ ok: true, kind: parsed.kind, filename, force, ...summary });
}
