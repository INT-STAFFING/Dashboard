import { DashboardSkeleton } from '@/components/Skeletons';

// Streams instantly on navigation while the SSR payload (session + portfolio
// queries) is being computed, instead of leaving the previous page frozen or
// showing a blank screen on hard loads.
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
