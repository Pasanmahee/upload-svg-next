import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { Storage } from '@google-cloud/storage';

export const runtime = 'nodejs';

// -----------------------------
// Env (server-only)
// -----------------------------
// Prefer MONGODB_URI; keep NEXT_PUBLIC_MONGODB_URI only as a temporary fallback.
const mongoUri = process.env.MONGODB_URI || process.env.NEXT_PUBLIC_MONGODB_URI;
const defaultBucketName = process.env.GCS_BUCKET;
const saKeyB64 = process.env.GCP_SA_KEY_B64;

if (!mongoUri) throw new Error('Missing environment variable: MONGODB_URI');
if (!defaultBucketName) throw new Error('Missing environment variable: GCS_BUCKET');
if (!saKeyB64) throw new Error('Missing environment variable: GCP_SA_KEY_B64');

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

// 15 minutes (change if needed; V4 max is 7 days) (Google Cloud, n.d.). :contentReference[oaicite:2]{index=2}
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

  if (value.startsWith('gs://')) {
    const rest = value.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const httpsPrefix = 'https://storage.googleapis.com/';
  if (value.startsWith(httpsPrefix)) {
    const rest = value.slice(httpsPrefix.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  // Treat as object path
  const objectPath = value.replace(/^\/+/, '');
  if (!objectPath) return null;
  return { bucket: defaultBucketName, objectPath };
}

async function signReadUrl(maybeUrlOrPath) {
  const target = parseGcsObjectRef(maybeUrlOrPath);
  if (!target) return maybeUrlOrPath;

  // V4 GET signed URL (Google’s official sample pattern) (Google Cloud, n.d.). :contentReference[oaicite:3]{index=3}
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
  const { searchParams } = new URL(req.url);

  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const categoryId = searchParams.get('categoryId');

  // deviceRam: if missing or "unknown", default to 2GB.
  const deviceRamParam = searchParams.get('deviceRam');
  let deviceRam;
  if (!deviceRamParam || deviceRamParam.toLowerCase() === 'unknown') {
    deviceRam = 2;
  } else {
    deviceRam = Number.parseFloat(deviceRamParam);
  }

  const threshold = 5;
  const isLowComplexity = deviceRam < threshold;

  const skip = (page - 1) * limit;

  const client = await clientPromise;
  const database = client.db('svgfacetpaintbynumber');
  const collection = database.collection('svgdata');

  // Build query
  const query = {};
  if (categoryId) query.categories = categoryId;

  // Preserve your existing logic
  query.hasSimplifiedSvg = isLowComplexity ? true : false;

  const projection = {
    _id: 1,
    categories: 1,
    date: 1,
    pngData: 1,
  };

  const data = await collection
    .find(query, { projection })
    .skip(skip)
    .limit(limit)
    .toArray();

  // Replace pngData with a signed URL (bucket stays private)
  const signedData = await Promise.all(
    data.map(async (doc) => {
      if (!doc?.pngData) return doc;
      try {
        const pngData = await signReadUrl(doc.pngData);
        return { ...doc, pngData };
      } catch (err) {
        // If signing fails, return original value (helps debugging)
        console.error('Failed to sign pngData', { pngData: doc.pngData, err });
        return doc;
      }
    })
  );

  const total = await collection.countDocuments(query);
  const totalPages = Math.ceil(total / limit);

  return NextResponse.json(
    {
      data: signedData,
      page,
      totalPages,
      total,
    },
    { headers }
  );
}
