import { NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/auth';
import {
  approveUser,
  rejectUser,
  setUserRole,
  deleteUser,
  getUserById,
} from '@/lib/users';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

const ROLES: Role[] = ['ADMIN', 'USER', 'USERPLUS'];

// PATCH — approve / reject / change role
export async function PATCH(req: Request, { params }: Params) {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return NextResponse.json({ ok: false, error: 'Riservato agli amministratori' }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: 'ID non valido' }, { status: 400 });
  }
  if (!(await getUserById(id))) {
    return NextResponse.json({ ok: false, error: 'Utente non trovato' }, { status: 404 });
  }

  let body: { action?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }

  try {
    let updated;
    switch (body.action) {
      case 'approve':
        updated = await approveUser(id);
        break;
      case 'reject':
        updated = await rejectUser(id);
        break;
      case 'setRole':
        if (!body.role || !ROLES.includes(body.role as Role)) {
          return NextResponse.json({ ok: false, error: 'Ruolo non valido' }, { status: 400 });
        }
        updated = await setUserRole(id, body.role as Role);
        break;
      default:
        return NextResponse.json({ ok: false, error: 'Azione non valida' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, user: updated });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore' },
      { status: 409 },
    );
  }
}

// DELETE — remove a user (ADMIN accounts are protected)
export async function DELETE(_req: Request, { params }: Params) {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return NextResponse.json({ ok: false, error: 'Riservato agli amministratori' }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: 'ID non valido' }, { status: 400 });
  }
  try {
    const ok = await deleteUser(id);
    if (!ok) return NextResponse.json({ ok: false, error: 'Utente non trovato' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore' },
      { status: 409 },
    );
  }
}
