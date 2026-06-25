import { NextRequest, NextResponse } from 'next/server';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Email',
  'Access-Control-Max-Age': '86400',
};

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
