/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';

export const runtime = 'nodejs';

function safeId(value: unknown): string | null {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return null;
  return id;
}

function toBuffer(value: any): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value?._bsontype === 'Binary' && typeof value.buffer !== 'undefined') return Buffer.from(value.buffer);
  if (value?.buffer) return Buffer.from(value.buffer);
  return null;
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> } | { params: { id: string } }) {
  const params = await Promise.resolve((ctx as any)?.params);
  const id = safeId(params?.id);
  if (!id) return new NextResponse('Invalid asset id', { status: 400 });

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const doc = await db.collection('gameAssets').findOne({ _id: id }, { projection: { data: 1, contentType: 1, sizeBytes: 1, updatedAt: 1, createdAt: 1 } });
    const buffer = toBuffer(doc?.data);
    if (!doc || !buffer) return new NextResponse('Not found', { status: 404 });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': String(doc.contentType || 'image/webp'),
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Failed to load asset', { status: 500 });
  }
}
