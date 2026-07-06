import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'uploadSvgAdminSession';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Email, x-admin-email',
  'Access-Control-Max-Age': '86400',
};

const encoder = new TextEncoder();

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const cleaned = email.trim().toLowerCase();
  return cleaned.includes('@') ? cleaned : null;
}

function getAdminEmails(): string[] {
  const raw = [process.env.ADMIN_EMAILS, process.env.ADMIN_EMAIL, process.env.FIREBASE_ADMIN_EMAILS]
    .filter(Boolean)
    .join(',');
  return Array.from(new Set(raw.split(/[;,\n]/g).map(normalizeEmail).filter((email): email is string => Boolean(email))));
}

function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email);
}

function getSessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ADMIN_EMAILS ||
    'dev-only-change-this-admin-session-secret'
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToString(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function hmacSha256(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function getValidSessionEmail(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token || !token.includes('.')) return null;

  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) return null;

  const expected = await hmacSha256(payload);
  if (!safeCompare(signature, expected)) return null;

  const json = base64UrlToString(payload);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as { email?: unknown };
    const email = normalizeEmail(parsed.email);
    if (!email || !isAdminEmail(email)) return null;
    return email;
  } catch {
    return null;
  }
}

function withCors(res: NextResponse) {
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|woff2?)$/i.test(pathname)
  );
}


function hasBearerAuthorization(req: NextRequest): boolean {
  return (req.headers.get('authorization') || '').toLowerCase().startsWith('bearer ');
}

function isAdminApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/admin/') || pathname === '/api/admin';
}

function isFirebaseAppApiRequest(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;

  // Do not let a Firebase mobile token bypass admin browser-session routes.
  if (!pathname.startsWith('/api/') || isAdminApiPath(pathname) || pathname.startsWith('/api/auth/')) {
    return false;
  }

  // Mobile/web app APIs use Firebase ID tokens. The proxy should only do a
  // light pass-through check here; each route handler still verifies the token
  // and applies its own ownership/privacy rules.
  return hasBearerAuthorization(req);
}

function isPublicApiRequest(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') return pathname.startsWith('/api/');

  // Public read APIs used by the Android/web app. These must not require the
  // backend admin browser session; otherwise the public app receives 401 before
  // the route handler can return daily puzzles, levels, categories, or images.
  if (method === 'GET') {
    return (
      pathname === '/api/images' ||
      pathname === '/api/categories' ||
      pathname === '/api/daily-challenge' ||
      pathname === '/api/levels' ||
      pathname === '/api/levels/images' ||
      pathname === '/api/completions' ||
      pathname === '/api/achievements' ||
      pathname === '/api/leaderboards' ||
      pathname === '/api/hints/status' ||
      pathname === '/api/dailyimagedata' ||
      pathname === '/api/pngdata' ||
      pathname === '/api/svgdata' ||
      pathname.startsWith('/api/game-assets/')
    );
  }

  // Claiming rewards / saving level progress remains protected inside the route
  // handlers by Firebase Authorization. The proxy should not require an admin
  // cookie for mobile users, but the route will still reject missing tokens.
  if (method === 'POST') {
    return (
      pathname === '/api/daily-challenge' ||
      pathname === '/api/levels/progress' ||
      pathname === '/api/progress/sync' ||
      pathname === '/api/completions' ||
      pathname === '/api/achievements/progress' ||
      pathname === '/api/scores' ||
      pathname === '/api/hints/use' ||
      pathname === '/api/hints/claim-daily' ||
      pathname.startsWith('/api/process-image/')
    );
  }

  return false;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  if (
    isStaticAsset(pathname) ||
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    isPublicApiRequest(req) ||
    isFirebaseAppApiRequest(req)
  ) {
    const res = NextResponse.next();
    return pathname.startsWith('/api/') ? withCors(res) : res;
  }

  const email = await getValidSessionEmail(req);

  if (!email) {
    if (pathname.startsWith('/api/')) {
      return withCors(NextResponse.json({ error: 'Login required' }, { status: 401 }));
    }

    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const res = NextResponse.next();
  return pathname.startsWith('/api/') ? withCors(res) : res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
