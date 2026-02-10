import { NextRequest, NextResponse } from 'next/server';

// Global CORS handling for all /api routes.
// This ensures OPTIONS preflight requests succeed consistently,
// even if an individual route handler does not export OPTIONS.
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, Email',
  // Cache preflight responses for 24h
  'Access-Control-Max-Age': '86400',
};

export function middleware(req: NextRequest) {
  // Only apply to API routes
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // For all other requests, continue and attach CORS headers
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
