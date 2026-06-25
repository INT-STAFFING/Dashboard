import { redirect } from 'next/navigation';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { getMeta, getRtiConfig } from '@/lib/config';
import { getTimeline, getSeniority } from '@/lib/portfolio';
import { listInterventi } from '@/lib/store';
import AdminGestione from '@/components/AdminGestione';

export const dynamic = 'force-dynamic';

export default async function GestionePage() {
  const me = await getSessionUser();
  if (!me) redirect('/login');
  if (!isAdmin(me)) redirect('/dashboard');

  const [meta, rti, timeline, seniority, interventi] = await Promise.all([
    getMeta(),
    getRtiConfig(),
    getTimeline(),
    getSeniority(),
    listInterventi(),
  ]);

  return (
    <AdminGestione
      meta={meta}
      rti={rti}
      timeline={timeline}
      seniority={seniority}
      interventi={interventi}
    />
  );
}
