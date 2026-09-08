import { NextResponse } from 'next/server';
import { getBucketName, getStorage, verifyGcsProxyToken } from '@/lib/gcs';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get('ref') || '';
  const exp = url.searchParams.get('exp') || '';
  const sig = url.searchParams.get('sig') || '';
  const target = verifyGcsProxyToken(ref, exp, sig);
  if (!target) return NextResponse.json({ error: 'Invalid or expired asset URL' }, { status: 403, headers: CORS_HEADERS });

  const allowedBuckets = new Set([
    getBucketName(),
    ...(process.env.GCS_ALLOWED_READ_BUCKETS || '').split(',').map((v: string) => v.trim()).filter(Boolean),
  ]);
  if (!allowedBuckets.has(target.bucket)) {
    return NextResponse.json({ error: 'Bucket not allowed' }, { status: 403, headers: CORS_HEADERS });
  }

  try {
    const file = getStorage().bucket(target.bucket).file(target.objectPath);
    const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType = metadata.contentType || 'application/octet-stream';
    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        ...(contentType.includes('svg') ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } : {}),
      },
    });
  } catch (error: any) {
    console.error('GCS proxy read failed:', error?.message || error);
    return NextResponse.json({ error: 'Asset could not be loaded' }, { status: 502, headers: CORS_HEADERS });
  }
}
