import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function isDataUrl(value: string) {
  return /^data:/i.test(value);
}

function toBase64DataUrl(buffer: Buffer, contentType: string) {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function sourceToDataUrl(source: unknown, fallbackContentType: string): Promise<string | null> {
  if (typeof source !== 'string' || !source) return null;
  if (isDataUrl(source)) return source;

  if (source.trim().startsWith('<svg')) {
    return toBase64DataUrl(Buffer.from(source, 'utf8'), 'image/svg+xml');
  }

  const res = await fetch(source, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch draft asset: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get('content-type') || fallbackContentType;
  const arrayBuffer = await res.arrayBuffer();
  return toBase64DataUrl(Buffer.from(arrayBuffer), contentType);
}

function safeName(name: unknown, fallback: string) {
  const raw = typeof name === 'string' && name.trim() ? name.trim() : fallback;
  return raw.split(/[/\\]/).pop()!.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || fallback;
}

export async function GET(request: Request, ctx: { params: Promise<{ draftId: string }> }) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const params = await Promise.resolve((ctx as any)?.params);
  const draftId = String((params as any)?.draftId || '');
  if (!ObjectId.isValid(draftId)) return json({ error: 'Invalid draft id.' }, 400);

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const draft = await db.collection('processDrafts').findOne({ _id: new ObjectId(draftId) });
    if (!draft) return json({ error: 'Draft not found. It may have expired or been cleared.' }, 404);

    if (draft.userId && draft.userId !== auth.uid) {
      return json({ error: 'Forbidden' }, 403);
    }

    const svgDataUrl = await sourceToDataUrl(draft.svgData, 'image/svg+xml');
    const previewDataUrl = await sourceToDataUrl(draft.pngData, draft.previewContentType || 'image/webp');

    return json({
      draftId,
      originalFileName: draft.originalFileName || 'processed-image',
      svgFileName: safeName(String(draft.originalFileName || 'processed-image').replace(/\.[^.]+$/, '') + '.svg', 'processed-image.svg'),
      previewFileName: safeName(String(draft.originalFileName || 'processed-image').replace(/\.[^.]+$/, '') + '-preview.webp', 'processed-preview.webp'),
      svgDataUrl,
      previewDataUrl,
      previewContentType: draft.previewContentType || 'image/webp',
      previewExt: draft.previewExt || 'webp',
      colors: Array.isArray(draft.colors) ? draft.colors : [],
      processOptions: draft.processOptions || null,
      createdAt: draft.createdAt || null,
      expiresAt: draft.expiresAt || null,
    });
  } catch (error: any) {
    return json({ error: error?.message || 'Failed to load process draft.' }, 500);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ draftId: string }> }) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const params = await Promise.resolve((ctx as any)?.params);
  const draftId = String((params as any)?.draftId || '');
  if (!ObjectId.isValid(draftId)) return json({ error: 'Invalid draft id.' }, 400);

  const client = await getMongoClient();
  const db = client.db(getDbName());
  const res = await db.collection('processDrafts').deleteOne({ _id: new ObjectId(draftId), userId: auth.uid });
  return json({ deleted: res.deletedCount > 0 });
}
