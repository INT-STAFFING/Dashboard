import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/auth/session';

// Paths reachable without a session.
const PUBLIC_PREFIXES = ['/login', '/register', '/api/auth'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifySession(token) : null;
  if (valid) return NextResponse.next();

  // No valid session: 401 for API, redirect to /login for pages.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Non autenticato' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
