import { redirect } from 'next/navigation';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getMeta, getRtiConfig } from '@/lib/config';
import { getSeniority } from '@/lib/portfolio';
import { getMultiYearTimeline } from '@/lib/timelineStore';
import { listInterventi } from '@/lib/store';
import AdminGestione from '@/components/AdminGestione';

export const dynamic = 'force-dynamic';

export default async function GestionePage() {
  // Data fetch races the session lookup; awaited only after the admin gate.
  const dataPromise = Promise.all([
    getMeta(),
    getRtiConfig(),
    getMultiYearTimeline(),
    getSeniority(),
    listInterventi(),
  ]);
  dataPromise.catch(() => {});
  const me = await getSessionUser();
  if (!me) redirect('/login');
  if (!isAdmin(me)) redirect('/dashboard');

  const [meta, rti, multiYear, seniority, interventi] = await dataPromise;

  return (
    <AdminGestione
      meta={meta}
      rti={rti}
      multiYear={multiYear}
      seniority={seniority}
      interventi={interventi}
    />
  );
}
