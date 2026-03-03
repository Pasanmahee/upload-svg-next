/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage } from '@/lib/gcs';
import { verifyFirebaseAuth } from '@/lib/auth';

export const runtime = 'nodejs';

// Signed URLs are temporary.
const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes

type GcsRef = { bucket: string; objectPath: string };

function setCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key',
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

  // Don’t attempt to sign inline data URLs
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

async function signReadUrl(maybeUrlOrPath: unknown): Promise<unknown> {
  const ref = parseGcsObjectRef(maybeUrlOrPath);
  if (!ref) return maybeUrlOrPath;

  try {
    const storage = getStorage();
    const [signedUrl] = await storage
      .bucket(ref.bucket)
      .file(ref.objectPath)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
    return signedUrl;
  } catch {
    return maybeUrlOrPath;
  }
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

export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

/**
 * GET /api/images?scope=public|mine|all&page=1&limit=24
 *
 * - public: records without userId (default)
 * - mine: records with userId === verified Firebase uid
 * - all: public + mine (requires admin key)
 */
export async function GET(request: Request) {
  const headers = setCORSHeaders();

  try {
    const { searchParams } = new URL(request.url);
    const scope = (searchParams.get('scope') || 'public').toLowerCase();

    const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = Number.parseInt(searchParams.get('limit') || '24', 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 24;
    const skip = (page - 1) * limit;

    // Auth / admin
    const auth = await verifyFirebaseAuth(request);
    const uid = auth.ok ? auth.uid : null;

    const adminKey = process.env.ADMIN_EDIT_KEY || process.env.ADMIN_DELETE_KEY || '';
    const providedAdminKey = request.headers.get('x-admin-key') || '';
    const isAdmin = Boolean(adminKey) && providedAdminKey === adminKey;

    let query: any = {};
    if (scope === 'mine') {
      if (!uid) {
        return NextResponse.json({ data: [], page, totalPages: 1, total: 0 }, { headers });
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

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');

    const projection = {
      _id: 1,
      userId: 1,
      pngData: 1,
      svgData: 1,
      colors: 1,
      categories: 1,
      hasSimplifiedSvg: 1,
      createdAt: 1,
      updatedAt: 1,
      date: 1,
    };

    const docs = await collection
      .find(query, { projection })
      .sort({ createdAt: -1, date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const data = await Promise.all(
      (docs || []).map(async (d: any) => {
        const pngData = await signReadUrl(d?.pngData);
        const svgData = await signReadUrl(d?.svgData);

        return {
          ...d,
          _id: d?._id?.toString?.() ?? String(d?._id ?? ''),
          pngData,
          svgData,
          createdAt: toIso(d?.createdAt),
          updatedAt: toIso(d?.updatedAt),
          date: toIso(d?.date),
        };
      })
    );

    const total = await collection.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({ data, page, totalPages, total }, { headers });
  } catch (err: unknown) {
    console.error('images GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch images', details: getErrorMessage(err) },
      { status: 500, headers }
    );
  }
}
