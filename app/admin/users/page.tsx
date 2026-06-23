import { redirect } from 'next/navigation';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { listUsers } from '@/lib/users';
import UsersAdmin from '@/components/UsersAdmin';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const me = await getSessionUser();
  if (!me) redirect('/login');
  if (!isAdmin(me)) redirect('/dashboard');

  const users = await listUsers();
  return <UsersAdmin initial={users} meId={me.id} adminEmail={me.email} />;
}
