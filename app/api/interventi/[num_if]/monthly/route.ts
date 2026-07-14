import { NextResponse } from 'next/server';
import { getIntervento } from '@/lib/store';
import { listPdcByBdo } from '@/lib/reportPdcStore';
import { listSalByBdo } from '@/lib/verbaliSalStore';
import { listBef } from '@/lib/befStore';
import { getSessionUser, canView } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { num_if: string } };

// Monthly detail behind an IF/BO's aggregate PDC / V.SAL / BEF status
// (Dettaglio IF drill-down): one row per periodo di competenza, sourced from
// the dedicated REPORT Pdc / REPORT Sal / BEF uploads.
export async function GET(_req: Request, { params }: Params) {
  if (!canView(await getSessionUser())) {
    return NextResponse.json({ ok: false, error: 'Non autorizzato' }, { status: 403 });
  }
  const intervento = await getIntervento(params.num_if);
  if (!intervento) {
    return NextResponse.json({ ok: false, error: 'Non trovato' }, { status: 404 });
  }
  const bdo = intervento.bdo || '';
  const [pdc, sal, bef] = await Promise.all([
    listPdcByBdo(bdo),
    listSalByBdo(bdo),
    listBef(intervento.numero_if),
  ]);
  return NextResponse.json({ ok: true, pdc, sal, bef });
}
