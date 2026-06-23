import { redirect } from 'next/navigation';
import { getSessionUser, canEdit } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Upload mutates data — only ADMIN / USERPLUS may reach the page.
export default async function UploadLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canEdit(user)) redirect('/dashboard');
  return <>{children}</>;
}
