import { NextResponse } from 'next/server';
import { parseFile, type FileKind, type ParseOutput } from '@/lib/parsers';
import { upsertInterventiFromUpload, listInterventi } from '@/lib/store';
import { persistBefFromUpload } from '@/lib/befStore';
import { persistReportBdoFromUpload } from '@/lib/reportBdoStore';
import { persistReportRdiFromUpload } from '@/lib/reportRdiStore';
import { persistVerbaliAperturaFromUpload } from '@/lib/verbaliAperturaStore';
import { persistVerbaliSalFromUpload } from '@/lib/verbaliSalStore';
import { persistReportPdcFromUpload } from '@/lib/reportPdcStore';
import { setSeniority } from '@/lib/portfolio';
import { updateMeta } from '@/lib/config';
import { getSessionUser, canEdit } from '@/lib/auth';
import type {
  BefRecord,
  DocStatus,
  Intervento,
  ReportBdoRecord,
  ReportRdiRecord,
  VerbaleAperturaRecord,
  VerbaleSalRecord,
  ReportPdcRecord,
} from '@/lib/types';

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

// Normalize an untrusted BEF row (client-side parse) into the canonical shape.
// A BEF row is meaningful only if it carries the BDO it reports on.
function normalizeBef(raw: unknown): BefRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num_bdo = sval(r.num_bdo);
  const num_fattura = sval(r.num_fattura);
  if (!num_bdo && !num_fattura) return null;
  const imp = r.importo_ricezione;
  return {
    num_bdo,
    descrizione: sval(r.descrizione),
    periodo_competenza: sval(r.periodo_competenza),
    fornitore_reale: sval(r.fornitore_reale),
    importo_ricezione: imp == null || imp === '' ? null : num(imp),
    num_fattura,
    data_fattura: sval(r.data_fattura),
    data_pagamento: sval(r.data_pagamento),
  };
}

// Normalize an untrusted "REPORT Bdo" row (client-side parse) into the
// canonical shape. Numero BDO is the business key, so a row without it is
// meaningless.
function normalizeReportBdo(raw: unknown): ReportBdoRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num_bdo = sval(r.num_bdo);
  if (!num_bdo) return null;
  return {
    num_bdo,
    descrizione_bdo: sval(r.descrizione_bdo),
    nome_file_pif_if: sval(r.nome_file_pif_if),
    descrizione_pif_if: sval(r.descrizione_pif_if),
    codifica_documento: sval(r.codifica_documento),
    stato_documento: sval(r.stato_documento),
    divisione: sval(r.divisione),
    centro_costo: sval(r.centro_costo),
    ultima_pif_approvata: sval(r.ultima_pif_approvata),
    data_caricamento: sval(r.data_caricamento),
    utente_caricamento: sval(r.utente_caricamento),
    fornitore: sval(r.fornitore),
    roi: sval(r.roi),
    data_invio_roi: sval(r.data_invio_roi),
    data_approvazione_roi: sval(r.data_approvazione_roi),
    data_rifiuto_roi: sval(r.data_rifiuto_roi),
    pmo: sval(r.pmo),
    data_invio_pmo: sval(r.data_invio_pmo),
    data_approvazione_pmo: sval(r.data_approvazione_pmo),
    data_rifiuto_pmo: sval(r.data_rifiuto_pmo),
    ctrm: sval(r.ctrm),
    data_invio_ctrm: sval(r.data_invio_ctrm),
    data_approvazione_ctrm: sval(r.data_approvazione_ctrm),
    data_rifiuto_ctrm: sval(r.data_rifiuto_ctrm),
    versione_corrente: sval(r.versione_corrente),
    data_versione_corrente: sval(r.data_versione_corrente),
    data_decorrenza: sval(r.data_decorrenza),
  };
}

// Normalize an untrusted "REPORT Rdi" row (client-side parse) into the
// canonical shape. Numero RDI is the business key, so a row without it is
// meaningless.
function normalizeReportRdi(raw: unknown): ReportRdiRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const numero_rdi = sval(r.numero_rdi);
  if (!numero_rdi) return null;
  return {
    numero_rdi,
    descrizione_rdi: sval(r.descrizione_rdi),
    nome_file_pif_if: sval(r.nome_file_pif_if),
    codifica_documento: sval(r.codifica_documento),
    stato_documento: sval(r.stato_documento),
    divisione: sval(r.divisione),
    centro_costo: sval(r.centro_costo),
    ultima_pif_approvata: sval(r.ultima_pif_approvata),
    descrizione_pif_if: sval(r.descrizione_pif_if),
    data_caricamento: sval(r.data_caricamento),
    utente_caricamento: sval(r.utente_caricamento),
    fornitore: sval(r.fornitore),
    roi: sval(r.roi),
    data_invio_roi: sval(r.data_invio_roi),
    data_rifiuto_roi: sval(r.data_rifiuto_roi),
    data_approvazione_roi: sval(r.data_approvazione_roi),
  };
}

// Normalize an untrusted "REPORT Apertura" row (client-side parse) into the
// canonical shape. A row without a BDO carries no useful information.
function normalizeVerbaleApertura(raw: unknown): VerbaleAperturaRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num_bdo = sval(r.num_bdo);
  if (!num_bdo) return null;
  return {
    num_bdo,
    descrizione: sval(r.descrizione),
    nome_file: sval(r.nome_file),
    codifica_documento: sval(r.codifica_documento),
    stato_verbale: sval(r.stato_verbale),
    periodo_competenza: sval(r.periodo_competenza),
    divisione: sval(r.divisione),
    centro_costo: sval(r.centro_costo),
    fornitore: sval(r.fornitore),
    utente_caricamento_fornitore: sval(r.utente_caricamento_fornitore),
    data_firma_fornitore: sval(r.data_firma_fornitore),
    roi: sval(r.roi),
    data_inserimento_verbale_non_sottomesso: sval(r.data_inserimento_verbale_non_sottomesso),
    data_sottomissione_verbale_fornitore: sval(r.data_sottomissione_verbale_fornitore),
    data_firma_roi: sval(r.data_firma_roi),
    data_rifiuto_roi: sval(r.data_rifiuto_roi),
    data_invio_roi: sval(r.data_invio_roi),
  };
}

// Normalize an untrusted "REPORT Sal" row (client-side parse) into the
// canonical shape. A row without a BDO carries no useful information.
function normalizeVerbaleSal(raw: unknown): VerbaleSalRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num_bdo = sval(r.num_bdo);
  if (!num_bdo) return null;
  return {
    num_bdo,
    descrizione: sval(r.descrizione),
    nome_file: sval(r.nome_file),
    codifica_documento: sval(r.codifica_documento),
    stato_verbale: sval(r.stato_verbale),
    periodo_competenza: sval(r.periodo_competenza),
    conforme: sval(r.conforme),
    motivo_conformita: sval(r.motivo_conformita),
    criticita: sval(r.criticita),
    motivazione_criticita: sval(r.motivazione_criticita),
    livelli_servizio_rispettati: sval(r.livelli_servizio_rispettati),
    divisione: sval(r.divisione),
    centro_costo: sval(r.centro_costo),
    fornitore: sval(r.fornitore),
    utente_caricamento_fornitore: sval(r.utente_caricamento_fornitore),
    data_firma_fornitore: sval(r.data_firma_fornitore),
    roi: sval(r.roi),
    data_inserimento_verbale_non_sottomesso: sval(r.data_inserimento_verbale_non_sottomesso),
    data_sottomissione_verbale_fornitore: sval(r.data_sottomissione_verbale_fornitore),
    data_firma_roi: sval(r.data_firma_roi),
    data_rifiuto_roi: sval(r.data_rifiuto_roi),
    data_invio_roi: sval(r.data_invio_roi),
  };
}

// Normalize an untrusted "REPORT Pdc" row (client-side parse) into the
// canonical shape. A row without a BDO carries no useful information.
function normalizeReportPdc(raw: unknown): ReportPdcRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num_bdo = sval(r.num_bdo);
  if (!num_bdo) return null;
  return {
    num_bdo,
    posizione_bdo: sval(r.posizione_bdo),
    descrizione_posizione: sval(r.descrizione_posizione),
    importo_posizione: r.importo_posizione == null ? null : num(r.importo_posizione),
    codice_pdc: sval(r.codice_pdc),
    periodo_pdc: sval(r.periodo_pdc),
    data_creazione: sval(r.data_creazione),
    utente_caricamento: sval(r.utente_caricamento),
    codifica_documento: sval(r.codifica_documento),
    stato_pdc: sval(r.stato_pdc),
    divisione: sval(r.divisione),
    centro_costo: sval(r.centro_costo),
    fornitore_rti: sval(r.fornitore_rti),
    roi: sval(r.roi),
    data_invio_roi: sval(r.data_invio_roi),
    data_rifiuto_roi: sval(r.data_rifiuto_roi),
    data_approvazione_roi: sval(r.data_approvazione_roi),
    fornitore_prestazione: sval(r.fornitore_prestazione),
    service_line: sval(r.service_line),
    tipo_fornitura: sval(r.tipo_fornitura),
    rdi: sval(r.rdi),
    posizione_rdi: sval(r.posizione_rdi),
    subappalto: sval(r.subappalto),
    subappaltatore: sval(r.subappaltatore),
    costo_subappalto: r.costo_subappalto == null ? null : num(r.costo_subappalto),
  };
}

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
  const consMesi = Array.isArray(r.cons_mesi) ? r.cons_mesi.map(num) : [];
  const cons_mesi = Array.from({ length: 12 }, (_, i) => consMesi[i] ?? 0);
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
    cons_mesi,
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
  let insertedIfs: string[] = [];
  let updatedIfs: string[] = [];
  let skippedIfs: string[] = [];

  if (parsed.interventi && parsed.interventi.length) {
    const res = await upsertInterventiFromUpload(parsed.interventi, force);
    inserted += res.inserted;
    updated += res.updated;
    skipped += res.skipped;
    insertedIfs = res.insertedIfs;
    updatedIfs = res.updatedIfs;
    skippedIfs = res.skippedIfs;
  }
  if (parsed.seniority && parsed.seniority.length) {
    await setSeniority(parsed.seniority);
  }

  // Resolve BDO -> numero_if from the saved portfolio (intervento.bdo). Shared
  // by BEF (resolves the owning IF) and REPORT Bdo (restricts saves to BDO
  // already present in the portfolio).
  let bdoToIf: Map<string, string> | null = null;
  if (
    (parsed.bef && parsed.bef.length) ||
    (parsed.reportBdo && parsed.reportBdo.length) ||
    (parsed.reportPdc && parsed.reportPdc.length)
  ) {
    bdoToIf = new Map<string, string>();
    for (const i of await listInterventi()) {
      if (i.bdo) bdoToIf.set(i.bdo, i.numero_if);
    }
  }

  let befSaved = 0;
  let befIfs: string[] = [];
  if (parsed.bef && parsed.bef.length) {
    const res = await persistBefFromUpload(parsed.bef, bdoToIf!);
    befSaved = res.saved;
    befIfs = res.ifs;
    if (res.unresolved) {
      errors.push(
        `BEF: ${res.unresolved} righe importate senza IF corrispondente (BDO non presente in portafoglio)`,
      );
    }
  }

  let reportBdoSaved = 0;
  let reportBdoIgnored = 0;
  if (parsed.reportBdo && parsed.reportBdo.length) {
    const res = await persistReportBdoFromUpload(parsed.reportBdo, new Set(bdoToIf!.keys()));
    reportBdoSaved = res.saved;
    reportBdoIgnored = res.ignored;
    if (res.ignored) {
      errors.push(`Report Bdo: ${res.ignored} righe ignorate (BDO non presente in portafoglio)`);
    }
  }

  let reportRdiSaved = 0;
  if (parsed.reportRdi && parsed.reportRdi.length) {
    const res = await persistReportRdiFromUpload(parsed.reportRdi);
    reportRdiSaved = res.saved;
  }

  let verbaliAperturaSaved = 0;
  if (parsed.verbaliApertura && parsed.verbaliApertura.length) {
    const res = await persistVerbaliAperturaFromUpload(parsed.verbaliApertura);
    verbaliAperturaSaved = res.saved;
  }

  let verbaliSalSaved = 0;
  if (parsed.verbaliSal && parsed.verbaliSal.length) {
    const res = await persistVerbaliSalFromUpload(parsed.verbaliSal);
    verbaliSalSaved = res.saved;
  }

  let reportPdcSaved = 0;
  let reportPdcIgnored = 0;
  if (parsed.reportPdc && parsed.reportPdc.length) {
    const res = await persistReportPdcFromUpload(parsed.reportPdc, new Set(bdoToIf!.keys()));
    reportPdcSaved = res.saved;
    reportPdcIgnored = res.ignored;
    if (res.ignored) {
      errors.push(`Report Pdc: ${res.ignored} righe ignorate (BDO non presente in portafoglio)`);
    }
  }

  if (parsed.kind === 'chiusura') {
    errors.push(`Chiusura: ${parsed.chiusura?.length ?? 0} righe lette (gestione Chiusura non ancora attiva)`);
  }
  // Allinea la data "dati al" mostrata nell'header al momento del caricamento.
  await updateMeta({ generato: new Date().toISOString() });
  return {
    inserted,
    updated,
    skipped,
    insertedIfs,
    updatedIfs,
    skippedIfs,
    bef_saved: befSaved,
    bef_ifs: befIfs,
    report_bdo_saved: reportBdoSaved,
    report_bdo_ignored: reportBdoIgnored,
    report_rdi_saved: reportRdiSaved,
    verbali_apertura_saved: verbaliAperturaSaved,
    verbali_sal_saved: verbaliSalSaved,
    report_pdc_saved: reportPdcSaved,
    report_pdc_ignored: reportPdcIgnored,
    seniority_rows: parsed.seniority?.length ?? 0,
    errors,
  };
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
    let body: {
      kind?: FileKind;
      interventi?: unknown[];
      bef?: unknown[];
      reportBdo?: unknown[];
      reportRdi?: unknown[];
      verbaliApertura?: unknown[];
      verbaliSal?: unknown[];
      reportPdc?: unknown[];
      seniority?: ParseOutput['seniority'];
      filename?: string;
    };
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
            'Tipo file non riconosciuto. Il nome deve contenere Dashboard / IF_ARIA / BEF / Chiusura / Aggregatore, oppure il file deve contenere il foglio "REPORT Bdo" / "REPORT Rdi" / "REPORT Apertura" / "REPORT Sal" / "REPORT Pdc".',
        },
        { status: 422 },
      );
    }
    const interventi = (body.interventi ?? [])
      .map(normalizeIntervento)
      .filter((i): i is Intervento => i !== null);
    const bef = (body.bef ?? [])
      .map(normalizeBef)
      .filter((b): b is BefRecord => b !== null);
    const reportBdo = (body.reportBdo ?? [])
      .map(normalizeReportBdo)
      .filter((b): b is ReportBdoRecord => b !== null);
    const reportRdi = (body.reportRdi ?? [])
      .map(normalizeReportRdi)
      .filter((b): b is ReportRdiRecord => b !== null);
    const verbaliApertura = (body.verbaliApertura ?? [])
      .map(normalizeVerbaleApertura)
      .filter((b): b is VerbaleAperturaRecord => b !== null);
    const verbaliSal = (body.verbaliSal ?? [])
      .map(normalizeVerbaleSal)
      .filter((b): b is VerbaleSalRecord => b !== null);
    const reportPdc = (body.reportPdc ?? [])
      .map(normalizeReportPdc)
      .filter((b): b is ReportPdcRecord => b !== null);
    const parsed: ParseOutput = {
      kind,
      interventi,
      bef,
      reportBdo,
      reportRdi,
      verbaliApertura,
      verbaliSal,
      reportPdc,
      seniority: body.seniority,
    };
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
