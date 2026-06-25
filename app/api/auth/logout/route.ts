import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, AUTH_EMAIL_COOKIE_NAME } from '@/lib/session';

export const runtime = 'nodejs';

function clearSession(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  res.cookies.set(AUTH_EMAIL_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}

export async function POST() {
  return clearSession(NextResponse.json({ ok: true }));
}

export async function GET(request: Request) {
  const url = new URL('/login', request.url);
  url.searchParams.set('loggedOut', '1');
  return clearSession(NextResponse.redirect(url));
}
