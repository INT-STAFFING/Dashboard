import { NextResponse } from 'next/server';
import { getUserByEmail, normalizeEmail, toSafeUser } from '@/lib/users';
import { verifyAgainstDummy, verifyPassword } from '@/lib/auth/password';
import { checkLoginAllowed, clearLoginFailures, clientIp, recordLoginFailure } from '@/lib/auth/loginThrottle';
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

  const subject = { email: normalizeEmail(email), ip: clientIp(req.headers) };
  const gate = await checkLoginAllowed(subject);
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Troppi tentativi di accesso falliti. Riprova più tardi.', retryAfterSec: gate.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  const user = await getUserByEmail(email);
  // Unknown email costs the same hashing work as a wrong password, so timing
  // doesn't reveal which emails are registered.
  const valid = user ? await verifyPassword(password, user.password_hash) : await verifyAgainstDummy(password);
  if (!user || !valid) {
    await recordLoginFailure(subject);
    return NextResponse.json({ ok: false, error: 'Credenziali non valide' }, { status: 401 });
  }
  await clearLoginFailures(subject.email);

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
