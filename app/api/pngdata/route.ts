/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { Storage } from '@google-cloud/storage';
import { getUidIfPresent } from "@/lib/auth";

export const runtime = 'nodejs';

// -----------------------------
// Env (server-only)
// -----------------------------
function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}


// ✅ Make these guaranteed strings (fixes "string | undefined")
const defaultBucketName: string = requiredEnv('GCS_BUCKET');
const saKeyB64: string = requiredEnv('GCP_SA_KEY_B64');

// Virtual categories (do NOT store in DB)
const VIRTUAL_CATEGORY_ALL_ID = 'all';
const VIRTUAL_CATEGORY_NEW_ID = 'new';

// "New" means last N days
const NEW_WINDOW_DAYS = Number.parseInt(process.env.NEW_WINDOW_DAYS || '30', 10) || 30;

// -----------------------------
// GCS (signed URLs)
// -----------------------------
type GcpCreds = { project_id?: string; [k: string]: any };

let gcpCredentials: GcpCreds;
try {
  const json = Buffer.from(saKeyB64, 'base64').toString('utf8');
  gcpCredentials = JSON.parse(json) as GcpCreds;
} catch {
  throw new Error('Invalid GCP_SA_KEY_B64: expected base64-encoded service account JSON');
}

const storage = new Storage({
  projectId: gcpCredentials.project_id,
  credentials: gcpCredentials as any,
});

// 15 minutes
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function getErrorMessage(err: unknown): string {
  // Catch variables are effectively unknown unless narrowed (TS 4.4+) (TypeScript, 2021). :contentReference[oaicite:1]{index=1}
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

type GcsRef = { bucket: string; objectPath: string };

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>
 *  - gs://<bucket>/<object>
 *  - <object> (object path only; assumes default bucket)
 */
function parseGcsObjectRef(value: string): GcsRef | null {
  if (!value) return null;

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

  // Treat as object path in default bucket
  const objectPath = noQuery.replace(/^\/+/, '');
  if (!objectPath) return null;
  return { bucket: defaultBucketName, objectPath };
}

async function signReadUrl(maybeUrlOrPath: string): Promise<string> {
  const target = parseGcsObjectRef(maybeUrlOrPath);
  if (!target) return maybeUrlOrPath;

  const [signedUrl] = await storage
    .bucket(target.bucket)
    .file(target.objectPath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });

  return signedUrl;
}

// Dedicated OPTIONS handler for CORS preflight
export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

// ✅ Proper Next.js route handler signature uses Web Request API (Next.js, 2025). :contentReference[oaicite:2]{index=2}
type Query = Record<string, any> & { $or?: any[] };

function isValidUserId(userId: unknown): userId is string {
  // Firebase UID typically matches this character set.
  // Keep it strict to reduce the risk of accidental operator injection.
  return typeof userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(userId);
}

function normalizeCategoryName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase();
}

export async function GET(req: Request) {
  const headers = setCORSHeaders();

  try {
    const { searchParams } = new URL(req.url);

    // Optional user context (used to scope private "Create" images)
    const uid = await getUidIfPresent(req);


    // Pagination
    const pageRaw = parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = parseInt(searchParams.get('limit') || '10', 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 10;
    const skip = (page - 1) * limit;

    // Filters
    const categoryIdRaw = searchParams.get('categoryId');
    const categoryId =
      typeof categoryIdRaw === 'string' && categoryIdRaw
        ? (categoryIdRaw.toLowerCase() === VIRTUAL_CATEGORY_ALL_ID
            ? VIRTUAL_CATEGORY_ALL_ID
            : categoryIdRaw.toLowerCase() === VIRTUAL_CATEGORY_NEW_ID
              ? VIRTUAL_CATEGORY_NEW_ID
              : categoryIdRaw)
        : null;

    const deviceRamParam = searchParams.get('deviceRam');
    const deviceRam =
      deviceRamParam && deviceRamParam.toLowerCase() !== 'unknown'
        ? Number.parseFloat(deviceRamParam)
        : Number.NaN;

    const threshold = 5;
    const hasValidRam = Number.isFinite(deviceRam);
    const isLowComplexity = hasValidRam && deviceRam < threshold;

    const client = await getMongoClient();
    const database = client.db(getDbName());
    const collection = database.collection('svgdata');
    const categoriesCollection = database.collection('categories');

    // ✅ Type-safe query object (fixes "$or does not exist on type {}")
    const baseQuery: Query = {};

    // -----------------------------
    // Privacy rule:
    // - Public library items: documents WITHOUT userId
    // - User-created items: documents WITH userId
    // In the landing page, we only show user-created items for the "Create" category,
    // and only for the requesting user.
    // -----------------------------
    let isCreateCategory = false;
    if (categoryId && categoryId !== VIRTUAL_CATEGORY_ALL_ID && categoryId !== VIRTUAL_CATEGORY_NEW_ID) {
      if (ObjectId.isValid(categoryId)) {
        const cat = await categoriesCollection.findOne(
          { _id: new ObjectId(categoryId) },
          { projection: { name: 1 } }
        );
        const n = normalizeCategoryName((cat as any)?.name);
        isCreateCategory = n === 'create' || n === 'my works' || n === 'my-works' || n === 'my creations' || n === 'created';
      }
    }

    if (isCreateCategory) {
      // If userId is missing/invalid, return empty instead of leaking other users' creations.
      if (!uid) {
        return NextResponse.json({ data: [], page, totalPages: 1, total: 0 }, { headers });
      }
      baseQuery.userId = uid;
    } else {
      // Hide all user-created/private items from the public library.
      baseQuery.userId = { $exists: false };
    }

    if (categoryId && categoryId !== VIRTUAL_CATEGORY_ALL_ID) {
      if (categoryId === VIRTUAL_CATEGORY_NEW_ID) {
        const since = new Date(Date.now() - NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const sinceISO = since.toISOString();

        baseQuery.$or = [{ createdAt: { $gte: since } }, { date: { $gte: sinceISO } }];
      } else {
        // ✅ values can contain both strings and ObjectIds
        const values: Array<string | ObjectId> = [categoryId];
        if (ObjectId.isValid(categoryId)) values.push(new ObjectId(categoryId));

        baseQuery.$or = [
          { categories: { $in: values } },
          { 'categories._id': { $in: values } },
        ];
      }
    }

    let query: Query = baseQuery;
    let usedSimplifiedFilter = false;
    let fellBackToFull = false;

    if (isLowComplexity) {
      query = { ...baseQuery, hasSimplifiedSvg: true };
      usedSimplifiedFilter = true;
    }

    const projection = {
      _id: 1,
      categories: 1,
      createdAt: 1,
      updatedAt: 1,
      date: 1,
      pngData: 1,
      hasSimplifiedSvg: 1,
    };

    let data = await collection
      .find(query, { projection })
      .sort({ createdAt: -1, date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    if (usedSimplifiedFilter && data.length === 0) {
      query = baseQuery;
      fellBackToFull = true;
      data = await collection
        .find(query, { projection })
        .sort({ createdAt: -1, date: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    }

    const signedData = await Promise.all(
      data.map(async (doc: any) => {
        if (!doc?.pngData || typeof doc.pngData !== 'string') return doc;
        try {
          const pngData = await signReadUrl(doc.pngData);
          return { ...doc, pngData };
        } catch {
          return doc;
        }
      })
    );

    const total = await collection.countDocuments(query);
    // Keep totalPages >= 1 so clients that assume at least one page don't break.
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const debug =
      searchParams.get('debug') === '1' && process.env.NODE_ENV === 'development'
        ? {
            query,
            page,
            limit,
            isLowComplexity,
            usedSimplifiedFilter,
            fellBackToFull,
            hasValidRam,
            deviceRamParam,
            categoryId,
            NEW_WINDOW_DAYS,
            matched: signedData.length,
            total,
          }
        : undefined;

    return NextResponse.json(
      { data: signedData, page, totalPages, total, ...(debug ? { debug } : {}) },
      { headers }
    );
  } catch (err: unknown) {
    console.error('pngdata GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch png data', details: getErrorMessage(err) },
      { status: 500, headers }
    );
  }
}
