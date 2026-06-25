import { NextResponse } from 'next/server';
import { getSessionEmailFromCookieHeader } from '@/lib/session';
import { isAdminEmail } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const email = await getSessionEmailFromCookieHeader(request.headers.get('cookie'));
  if (!email || !isAdminEmail(email)) {
    return NextResponse.json({ loggedIn: false }, { status: 401 });
  }
  return NextResponse.json({ loggedIn: true, email });
}
