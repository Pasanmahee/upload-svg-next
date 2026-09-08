/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage, resolveGcsReadUrl } from '@/lib/gcs';
import { isAdminEmail, verifyFirebaseAuth } from '@/lib/auth';

export const runtime = 'nodejs';

// Signed URLs are temporary.
const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 48;

type GcsRef = { bucket: string; objectPath: string };

function setCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email',
    'Cache-Control': 'no-store',
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>[?query]
 *  - gs://<bucket>/<object>
 *  - <objectPath> (assumes default bucket)
 */
function parseGcsObjectRef(value: unknown): GcsRef | null {
  if (typeof value !== 'string' || !value) return null;

  // Don’t attempt to sign inline data URLs.
  if (value.startsWith('data:')) return null;

  const noQuery = value.split('?')[0];

  if (noQuery.startsWith('gs://')) {
    const rest = noQuery.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const httpsPrefix = 'https://storage.googleapis.com/';
  if (noQuery.startsWith(httpsPrefix)) {
    const rest = noQuery.slice(httpsPrefix.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const objectPath = noQuery.replace(/^\/+/, '');
  if (!objectPath) return null;
  return { bucket: getBucketName(), objectPath };
}

async function signReadUrl(maybeUrlOrPath: unknown, origin: string): Promise<unknown> {
  return resolveGcsReadUrl(maybeUrlOrPath, origin, SIGNED_URL_TTL_MS);
}

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  try {
    if (typeof v?.toISOString === 'function') return v.toISOString();
  } catch {
    // ignore
  }
  return String(v);
}

function parseLimit(value: string | null): number {
  const raw = Number.parseInt(value || String(DEFAULT_PAGE_LIMIT), 10);
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT);
}

export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

/**
 * GET /api/images?scope=public|mine|all&limit=12&after=<mongoId>
 *
 * Lightweight cursor pagination:
 * - fetches only limit + 1 records, so it can know whether a next page exists
 * - avoids countDocuments(), which can be expensive on larger collections
 * - avoids skip() for normal next-page navigation
 * - list view returns pngData only; svgData is fetched from /api/images/:id only when a card is opened
 */
export async function GET(request: Request) {
  const headers = setCORSHeaders();

  try {
    const requestUrl = new URL(request.url);
    const { searchParams } = requestUrl;
    const scope = (searchParams.get('scope') || 'public').toLowerCase();
    const limit = parseLimit(searchParams.get('limit'));
    const after = searchParams.get('after') || '';

    const afterId = after && ObjectId.isValid(after) ? new ObjectId(after) : null;

    // Auth / admin
    const auth = await verifyFirebaseAuth(request);
    const uid = auth.ok ? auth.uid : null;
    const isAdmin = auth.ok && isAdminEmail(auth.email);

    let query: any = {};
    if (scope === 'mine') {
      if (!uid) {
        return NextResponse.json(
          { data: [], page: 1, limit, hasNext: false, hasPrev: Boolean(afterId), nextCursor: null },
          { headers }
        );
      }
      query = { userId: uid };
    } else if (scope === 'all') {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
      }
      query = {}; // all
    } else {
      // public
      query = { userId: { $exists: false } };
    }

    if (afterId) query._id = { $lt: afterId };

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');

    const projection = {
      _id: 1,
      userId: 1,
      pngData: 1,
      // Deliberately do not include svgData in list results. It may be large.
      colors: 1,
      categories: 1,
      hasSimplifiedSvg: 1,
      createdAt: 1,
      updatedAt: 1,
      date: 1,
      levelId: 1,
      title: 1,
      name: 1,
    };

    const docs = await collection
      .find(query, { projection })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .toArray();

    const pageDocs = docs.slice(0, limit);
    const hasNext = docs.length > limit;
    const lastDoc = pageDocs[pageDocs.length - 1];
    const nextCursor = hasNext && lastDoc?._id ? String(lastDoc._id) : null;

    const data = await Promise.all(
      (pageDocs || []).map(async (d: any) => {
        const pngData = await signReadUrl(d?.pngData, requestUrl.origin);

        return {
          ...d,
          _id: d?._id?.toString?.() ?? String(d?._id ?? ''),
          pngData,
          // The detail endpoint can load/sign this only when the user opens a card.
          svgData: undefined,
          hasSvgData: Boolean(d?.svgData),
          createdAt: toIso(d?.createdAt),
          updatedAt: toIso(d?.updatedAt),
          date: toIso(d?.date),
          levelId: typeof d?.levelId === 'string' ? d.levelId : null,
          title: typeof d?.title === 'string' ? d.title : typeof d?.name === 'string' ? d.name : null,
        };
      })
    );

    return NextResponse.json(
      {
        data,
        limit,
        hasNext,
        hasPrev: Boolean(afterId),
        nextCursor,
        paginationMode: 'cursor',
      },
      { headers }
    );
  } catch (err: unknown) {
    console.error('images GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch images', details: getErrorMessage(err) },
      { status: 500, headers }
    );
  }
}
