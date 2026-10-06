import { redirect } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
import AccessGate from '@/components/AccessGate';
import { getDashboardData } from '@/lib/getDashboardData';
import { getSessionUser, canView, canEdit, isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { anno?: string | string[] };
}) {
  // ?anno= picks the calendar year of the monthly profiles; anything invalid or
  // missing means the default year (see lib/mesiStore.ts#pickDefaultAnno).
  const annoParam = Array.isArray(searchParams?.anno) ? searchParams?.anno[0] : searchParams?.anno;
  // Start the (expensive) data assembly in parallel with the session lookup
  // instead of chaining the two round-trips; the promise is only awaited after
  // the auth gate passes. The catch below prevents an unhandled rejection when
  // the request bails out early (no session / not authorized).
  const dataPromise = getDashboardData(annoParam);
  dataPromise.catch(() => {});
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canView(user)) {
    return <AccessGate user={user} />;
  }
  const data = await dataPromise;
  return (
    <Dashboard
      initial={data}
      user={user}
      canEdit={canEdit(user)}
      isAdmin={isAdmin(user)}
    />
  );
}
