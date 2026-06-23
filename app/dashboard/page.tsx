import Dashboard from '@/components/Dashboard';
import { getDashboardData } from '@/lib/getDashboardData';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const data = await getDashboardData();
  return <Dashboard initial={data} />;
}
