import { NextResponse } from 'next/server';
import { createSessionToken, AUTH_COOKIE_NAME, AUTH_EMAIL_COOKIE_NAME, normalizeSessionEmail } from '@/lib/session';
import { isAdminEmail } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { email?: unknown } = {};
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const email = normalizeSessionEmail(body.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });

  if (!isAdminEmail(email)) {
    return NextResponse.json({ error: 'This email is not allowed. Add it to ADMIN_EMAILS.' }, { status: 403 });
  }

  const token = await createSessionToken(email);
  const res = NextResponse.json({ ok: true, email });

  res.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  // Non-sensitive helper cookie for showing the signed-in email in client UI.
  res.cookies.set(AUTH_EMAIL_COOKIE_NAME, email, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
