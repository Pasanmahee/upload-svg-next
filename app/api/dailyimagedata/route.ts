import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { Storage } from '@google-cloud/storage';

export const runtime = 'nodejs';


// -----------------------------
// Google Cloud Storage signing
// -----------------------------
function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

type GcpCreds = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let gcpCredentials: GcpCreds;
try {
  const saKeyB64 = requiredEnv('GCP_SA_KEY_B64');
  const json = Buffer.from(saKeyB64, 'base64').toString('utf8');
  gcpCredentials = JSON.parse(json) as GcpCreds;
} catch {
  throw new Error('Invalid GCP_SA_KEY_B64: expected base64-encoded service account JSON');
}

const defaultBucketName = requiredEnv('GCS_BUCKET');

const storage = new Storage({
  projectId: gcpCredentials.project_id,
  credentials: gcpCredentials as any,
});

// 15 minutes
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

type GcsRef = { bucket: string; objectPath: string };

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>
 *  - gs://<bucket>/<object>
 *  - <object> (object path only; assumes default bucket)
 * Returns null for data URLs and non-GCS http(s) urls.
 */
function parseGcsObjectRef(value: string): GcsRef | null {
  if (!value) return null;

  // Leave data URLs untouched
  if (value.startsWith('data:')) return null;

  const noQuery = value.split('?')[0];

  // Signed download URLs from Firebase/other domains: do not re-sign
  if (noQuery.startsWith('http') && !noQuery.includes('storage.googleapis.com')) return null;

  if (noQuery.startsWith('gs://')) {
    const rest = noQuery.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash <= 0) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    if (!objectPath) return null;
    return { bucket, objectPath };
  }

  const m = noQuery.match(/^https?:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
  if (m) {
    const bucket = m[1];
    const objectPath = m[2];
    if (!objectPath) return null;
    return { bucket, objectPath };
  }

  // Treat as object path in default bucket (e.g., "paintbynumbers-svg-123.png")
  // Only if it doesn't look like a full URL.
  if (noQuery.includes('://')) return null;

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

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/dailyimagedata?page=1&limit=10&deviceRam=4
 *
 * NOTE:
 * - This route must not create DB clients at module scope. Vercel/Next build
 *   may evaluate the module during "Collecting page data", and missing env vars
 *   would crash the build.
 */
export async function GET(request: Request) {
  const headers = corsHeaders;

  try {
    const { searchParams } = new URL(request.url);

    // Pagination
    const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = Number.parseInt(searchParams.get('limit') || '10', 10);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 10;
    const skip = (page - 1) * limit;

    // Device RAM (optional)
    const deviceRamParam = searchParams.get('deviceRam');
    const deviceRam =
      deviceRamParam && deviceRamParam.toLowerCase() !== 'unknown'
        ? Number.parseFloat(deviceRamParam)
        : Number.NaN;

    // Only apply "simplified" filter if RAM is a valid number and below threshold.
    const threshold = 5;
    const hasValidRam = Number.isFinite(deviceRam);
    const isLowComplexity = hasValidRam && deviceRam < threshold;

    // Connect to MongoDB (via shared helper / cached client)
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const collection = db.collection('svgdata');

    
// Daily feed = documents that do NOT have userId (public feed)
const baseQuery: Record<string, unknown> = {
  userId: { $exists: false },
};

const projection = {
  _id: 1,
  pngData: 1,
  date: 1,
};

async function fetchPage(query: Record<string, unknown>) {
  const total = await collection.countDocuments(query);
  const totalPages = Math.ceil(total / limit);

  const data = await collection
    .find(query, { projection })
    .sort({ date: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  // Ensure pngData is browser-loadable (sign gs:// or GCS object refs)
  const signedData = await Promise.all(
    data.map(async (doc: any) => {
      if (typeof doc?.pngData === 'string') {
        try {
          doc.pngData = await signReadUrl(doc.pngData);
        } catch {
          // If signing fails for any reason, fall back to original value
        }
      }
      return doc;
    })
  );

  return { data: signedData, total, totalPages };
}

// Prefer simplified SVGs on low-RAM devices if your docs are flagged accordingly.
// Fallback: if simplified filter yields nothing, retry without it.
let query: Record<string, unknown> = { ...baseQuery };
if (isLowComplexity) query.hasSimplifiedSvg = true;

let result = await fetchPage(query);
if (isLowComplexity && result.total === 0) {
  query = { ...baseQuery };
  result = await fetchPage(query);
}

return NextResponse.json(
  { data: result.data, page, totalPages: result.totalPages, total: result.total },
  { headers }
);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) },
      { status: 500, headers }
    );
  }
}