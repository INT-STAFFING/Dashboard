import { NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { listUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return NextResponse.json({ ok: false, error: 'Riservato agli amministratori' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, users: await listUsers() });
}
