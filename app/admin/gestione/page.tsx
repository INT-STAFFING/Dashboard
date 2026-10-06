import { redirect } from 'next/navigation';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getMeta, getRtiConfig } from '@/lib/config';
import { getSeniority } from '@/lib/portfolio';
import { getMultiYearTimeline } from '@/lib/timelineStore';
import { listInterventi } from '@/lib/store';
import { listAnni, resolveAnno } from '@/lib/mesiStore';
import AdminGestione from '@/components/AdminGestione';

export const dynamic = 'force-dynamic';

export default async function GestionePage() {
  // Data fetch races the session lookup; awaited only after the admin gate. The
  // per-IF monthly profiles are shown for the portfolio's default year; the page
  // lets the admin switch year.
  const dataPromise = Promise.all([
    getMeta(),
    getRtiConfig(),
    getMultiYearTimeline(),
    getSeniority(),
    resolveAnno().then(async (anno) => ({ anno, interventi: await listInterventi(anno), anni: await listAnni() })),
  ]);
  dataPromise.catch(() => {});
  const me = await getSessionUser();
  if (!me) redirect('/login');
  if (!isAdmin(me)) redirect('/dashboard');

  const [meta, rti, multiYear, seniority, { anno, anni, interventi }] = await dataPromise;

  return (
    <AdminGestione
      meta={meta}
      rti={rti}
      multiYear={multiYear}
      seniority={seniority}
      interventi={interventi}
      anno={anno}
      anni={anni.includes(anno) ? anni : [...anni, anno].sort((a, b) => a - b)}
    />
  );
}
