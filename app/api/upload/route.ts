import { NextResponse } from 'next/server';
import { parseFile } from '@/lib/parsers';
import { upsertInterventiFromUpload } from '@/lib/store';
import { setSeniority } from '@/lib/portfolio';
import { getSessionUser, canEdit } from '@/lib/auth';

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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'multipart/form-data atteso' },
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
          'Tipo file non riconosciuto. Il nome deve contenere IF_ARIA / BEF / Chiusura / Aggregatore.',
      },
      { status: 422 },
    );
  }

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
    // BEF / Chiusura are reference datasets; parsed but not yet persisted to DB.
    errors.push(`BEF: ${parsed.bef?.length ?? 0} righe lette (non persistite)`);
  }
  if (parsed.kind === 'chiusura') {
    errors.push(`Chiusura: ${parsed.chiusura?.length ?? 0} righe lette (non persistite)`);
  }

  return NextResponse.json({
    ok: true,
    kind: parsed.kind,
    filename,
    inserted,
    updated,
    skipped,
    seniority_rows: parsed.seniority?.length ?? 0,
    force,
    errors,
  });
}
