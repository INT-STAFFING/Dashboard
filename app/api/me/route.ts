import { NextResponse } from 'next/server';
import { getSessionUser, canView, canEdit, isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({
    ok: true,
    user,
    perms: { view: canView(user), edit: canEdit(user), admin: isAdmin(user) },
  });
}
