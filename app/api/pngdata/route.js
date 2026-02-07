import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { Storage } from '@google-cloud/storage';

export const runtime = 'nodejs';

// -----------------------------
// Env (server-only)
// -----------------------------
const mongoUri = process.env.MONGODB_URI || process.env.NEXT_PUBLIC_MONGODB_URI; // keep fallback if you still use it
const defaultBucketName = process.env.GCS_BUCKET;
const saKeyB64 = process.env.GCP_SA_KEY_B64;

if (!mongoUri) throw new Error('Missing environment variable: MONGODB_URI');
if (!defaultBucketName) throw new Error('Missing environment variable: GCS_BUCKET');
if (!saKeyB64) throw new Error('Missing environment variable: GCP_SA_KEY_B64');

// Virtual categories (do NOT store in DB)
const VIRTUAL_CATEGORY_ALL_ID = 'all';
const VIRTUAL_CATEGORY_NEW_ID = 'new';

// "New" means last N days
const NEW_WINDOW_DAYS = Number.parseInt(process.env.NEW_WINDOW_DAYS || '30', 10) || 30;

// -----------------------------
// Mongo (reuse connection)
// -----------------------------
const globalForMongo = globalThis;

let clientPromise;
if (process.env.NODE_ENV === 'development') {
  if (!globalForMongo._mongoClientPromise) {
    const client = new MongoClient(mongoUri);
    globalForMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalForMongo._mongoClientPromise;
} else {
  const client = new MongoClient(mongoUri);
  clientPromise = client.connect();
}

// -----------------------------
// GCS (signed URLs)
// -----------------------------
let gcpCredentials;
try {
  const json = Buffer.from(saKeyB64, 'base64').toString('utf8');
  gcpCredentials = JSON.parse(json);
} catch {
  throw new Error('Invalid GCP_SA_KEY_B64: expected base64-encoded service account JSON');
}

const storage = new Storage({
  projectId: gcpCredentials.project_id,
  credentials: gcpCredentials,
});

// 15 minutes (adjust if needed; V4 max is 7 days)
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>
 *  - gs://<bucket>/<object>
 *  - <object> (object path only; assumes default bucket)
 */
function parseGcsObjectRef(value) {
  if (!value || typeof value !== 'string') return null;

  // Strip query string if it exists (signed URL stored by mistake)
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

  // Treat as object path
  const objectPath = noQuery.replace(/^\/+/, '');
  if (!objectPath) return null;
  return { bucket: defaultBucketName, objectPath };
}

async function signReadUrl(maybeUrlOrPath) {
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

export async function GET(req) {
  const headers = setCORSHeaders();

  try {
    const { searchParams } = new URL(req.url);

    // Pagination
    const pageRaw = parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = parseInt(searchParams.get('limit') || '10', 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

    // keep sane bounds
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 10;
    const skip = (page - 1) * limit;

    // Filters
    const categoryIdRaw = searchParams.get('categoryId');
    // Normalize virtual categories regardless of casing
    const categoryId =
      typeof categoryIdRaw === 'string' && categoryIdRaw
        ? (categoryIdRaw.toLowerCase() === VIRTUAL_CATEGORY_ALL_ID
            ? VIRTUAL_CATEGORY_ALL_ID
            : categoryIdRaw.toLowerCase() === VIRTUAL_CATEGORY_NEW_ID
              ? VIRTUAL_CATEGORY_NEW_ID
              : categoryIdRaw)
        : null;

    // IMPORTANT:
    // - If deviceRam is missing or "unknown" or non-numeric -> do NOT apply complexity filter.
    // - Only apply hasSimplifiedSvg=true when deviceRam is a valid number and below threshold.
    const deviceRamParam = searchParams.get('deviceRam');
    const deviceRam =
      deviceRamParam && typeof deviceRamParam === 'string' && deviceRamParam.toLowerCase() !== 'unknown'
        ? Number.parseFloat(deviceRamParam)
        : Number.NaN;

    const threshold = 5;
    const hasValidRam = Number.isFinite(deviceRam);
    const isLowComplexity = hasValidRam && deviceRam < threshold;

    const client = await clientPromise;
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection('svgdata');

    // Build query
    const baseQuery = {};

    // Virtual category handling
    if (categoryId && categoryId !== VIRTUAL_CATEGORY_ALL_ID) {
      if (categoryId === VIRTUAL_CATEGORY_NEW_ID) {
        // New = last NEW_WINDOW_DAYS days
        const since = new Date(Date.now() - NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const sinceISO = since.toISOString();

        // Support both styles:
        // - createdAt: Date
        // - date: ISO string (legacy)
        baseQuery.$or = [
          { createdAt: { $gte: since } },
          { date: { $gte: sinceISO } },
        ];
      } else {
        // Real category match (robust against string/ObjectId/embedded categories)
        const values = [categoryId];
        if (ObjectId.isValid(categoryId)) values.push(new ObjectId(categoryId));

        baseQuery.$or = [
          { categories: { $in: values } },
          { 'categories._id': { $in: values } },
        ];
      }
    }
    // Prefer simplified SVGs on low-RAM devices, but fall back if none exist.
    const queryBase = baseQuery;
    let query = queryBase;
    let usedSimplifiedFilter = false;
    let fellBackToFull = false;
    if (isLowComplexity) {
      query = { ...queryBase, hasSimplifiedSvg: true };
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

    // If the simplified filter yields no results, fall back to the full set.
    if (usedSimplifiedFilter && (!data || data.length === 0)) {
      query = queryBase;
      fellBackToFull = true;
      data = await collection
        .find(query, { projection })
        .sort({ createdAt: -1, date: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    }

    // Replace pngData with signed URL (bucket stays private)
    const signedData = await Promise.all(
      data.map(async (doc) => {
        if (!doc?.pngData) return doc;
        try {
          const pngData = await signReadUrl(doc.pngData);
          return { ...doc, pngData };
        } catch (err) {
          console.error('Failed to sign pngData', { pngData: doc.pngData, err });
          return doc;
        }
      })
    );

    const total = await collection.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    const debug = searchParams.get('debug') === '1' && process.env.NODE_ENV === 'development'
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
      {
        data: signedData,
        page,
        totalPages,
        total,
        ...(debug ? { debug } : {}),
      },
      { headers }
    );
  } catch (err) {
    console.error('pngdata GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch png data' }, { status: 500, headers });
  }
}