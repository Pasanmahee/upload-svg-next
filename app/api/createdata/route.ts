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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Prevent intermediary caching across users.
    'Cache-Control': 'no-store',
    Vary: 'Authorization',
  };
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Failed to load data';
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

  // Strip querystring (works for already-signed URLs too)
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

  // Treat as object path in the default bucket
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
    // If signing fails (e.g., no credentials), fall back to original value.
    return maybeUrlOrPath;
  }
}

export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

/**
 * GET /api/createdata?page=1&limit=10
 *
 * Returns ONLY the authenticated user's created images.
 * Authentication: Authorization: Bearer <Firebase ID token>
 */

export async function POST(request: Request) {
  const headers = {
    ...setCORSHeaders(),
    'Cache-Control': 'no-store',
    Vary: 'Authorization',
  };

  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'MONGODB_URI is not configured' }, { status: 500, headers });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const svgObjectPath = typeof body?.svgObjectPath === 'string' ? body.svgObjectPath : '';
  const pngObjectPath = typeof body?.pngObjectPath === 'string' ? body.pngObjectPath : '';
  const categories = Array.isArray(body?.categories) ? body.categories.map((x: any) => String(x)) : [];
  const hasSimplifiedSvg = Boolean(body?.hasSimplifiedSvg);

  // Colors: accept array OR { palette, stroke } object (same as /api/svgdata).
  let colors: string[] = [];
  try {
    const raw = body?.colors;
    if (Array.isArray(raw)) colors = raw.map((c: any) => String(c).trim()).filter(Boolean);
    else if (raw && typeof raw === 'object' && Array.isArray(raw.palette)) {
      colors = raw.palette.map((c: any) => String(c).trim()).filter(Boolean);
    }
  } catch {
    colors = [];
  }

  function isSafeObjectPath(p: string) {
    if (!p) return false;
    if (p.length > 512) return false;
    if (p.includes('..')) return false;
    if (p.startsWith('/')) return false;
    // Force per-user namespace for safety
    if (!p.startsWith(`users/${auth.uid}/`)) return false;
    return true;
  }

  if (!isSafeObjectPath(svgObjectPath) || !isSafeObjectPath(pngObjectPath)) {
    return NextResponse.json(
      { error: 'Invalid object paths' },
      { status: 400, headers }
    );
  }

  const bucketName = getBucketName();
  const svgData = `gs://${bucketName}/${svgObjectPath}`;
  const pngData = `gs://${bucketName}/${pngObjectPath}`;

  try {
    const client = await getMongoClient();
    const database = client.db(getDbName());
    const collection = database.collection('svgdata');

    // Enforce per-user limit (same env as /api/process-image).
    const maxPerUser = Number.parseInt(process.env.MAX_RECORDS_PER_USER || '1', 10);
    if (Number.isFinite(maxPerUser) && maxPerUser > 0) {
      const count = await collection.countDocuments({ userId: auth.uid });
      if (count >= maxPerUser) {
        return NextResponse.json(
          { error: `Max created works limit reached (${maxPerUser})` },
          { status: 403, headers }
        );
      }
    }

    const now = new Date();
    const insertRes = await collection.insertOne({
      userId: auth.uid,
      svgData,
      pngData,
      colors,
      categories,
      hasSimplifiedSvg,
      createdAt: now,
      updatedAt: now,
      date: now.toISOString(),
    });

    // Return signed read URLs for immediate display.
    const signedSvg = await signReadUrl(svgData);
    const signedPng = await signReadUrl(pngData);

    return NextResponse.json(
      {
        message: 'Created work saved',
        recordId: insertRes.insertedId.toString(),
        svgData: signedSvg || svgData,
        pngData: signedPng || pngData,
        colors,
        categories,
        hasSimplifiedSvg,
      },
      { status: 200, headers }
    );
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500, headers });
  }
}


export async function GET(request: Request) {
  const headers = setCORSHeaders();

  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers },
    );
  }

  try {
    const { searchParams } = new URL(request.url);

    const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = Number.parseInt(searchParams.get('limit') || '10', 10);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 10;
    const skip = (page - 1) * limit;

    const client = await getMongoClient();
    const database = client.db(getDbName());
    const collection = database.collection('svgdata');

    const query = { userId: auth.uid };

    const data = await collection
      .find(query, {
        projection: { _id: 1, userId: 1, pngData: 1, date: 1, createdAt: 1 },
      })
      .sort({ createdAt: -1, date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const signedData = await Promise.all(
      (data || []).map(async (doc: any) => {
        if (!doc?.pngData) return doc;
        const pngData = await signReadUrl(doc.pngData);
        return { ...doc, pngData };
      }),
    );

    const total = await collection.countDocuments(query);
    const totalPages = Math.ceil(total / limit) || 1;

    return NextResponse.json({ data: signedData, page, totalPages, total }, { headers });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500, headers });
  }
}
