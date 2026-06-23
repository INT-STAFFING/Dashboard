import { NextResponse } from 'next/server';
import { getUserByEmail, toSafeUser } from '@/lib/users';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
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

  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ ok: false, error: 'Credenziali non valide' }, { status: 401 });
  }

  if (user.status === 'pending') {
    return NextResponse.json(
      { ok: false, status: 'pending', error: "Account in attesa di approvazione dell'amministratore" },
      { status: 403 },
    );
  }
  if (user.status === 'rejected') {
    return NextResponse.json(
      { ok: false, status: 'rejected', error: "Accesso negato dall'amministratore" },
      { status: 403 },
    );
  }

  const token = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true, user: toSafeUser(user) });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
