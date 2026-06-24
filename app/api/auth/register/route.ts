import { NextResponse } from 'next/server';
import { createUser } from '@/lib/users';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { email?: string; name?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON non valido' }, { status: 400 });
  }

  const email = (body.email || '').trim();
  const password = body.password || '';
  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: 'Email e password sono obbligatorie' },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'Email non valida' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, error: 'La password deve avere almeno 6 caratteri' },
      { status: 400 },
    );
  }
  // Self-registration can only request USER or USERPLUS.
  const role: Role = body.role === 'USERPLUS' ? 'USERPLUS' : 'USER';

  try {
    const user = await createUser({ email, name: body.name?.trim() || null, password, role });
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Errore' },
      { status: 409 },
    );
  }
}
