import { redirect } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
import AccessGate from '@/components/AccessGate';
import { getDashboardData } from '@/lib/getDashboardData';
import { getSessionUser, canView, canEdit, isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canView(user)) {
    return <AccessGate user={user} />;
  }
  const data = await getDashboardData();
  return (
    <Dashboard
      initial={data}
      user={user}
      canEdit={canEdit(user)}
      isAdmin={isAdmin(user)}
    />
  );
}
