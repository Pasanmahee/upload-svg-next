/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { Storage } from '@google-cloud/storage';

export const runtime = 'nodejs';

// -----------------------------
// Env (server-only)
// -----------------------------
function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

// Keep fallback if you still use it, but prefer MONGODB_URI
const mongoUri = process.env.MONGODB_URI ?? process.env.NEXT_PUBLIC_MONGODB_URI;
if (!mongoUri) throw new Error('Missing environment variable: MONGODB_URI');

const defaultBucketName = requiredEnv('GCS_BUCKET');
const saKeyB64 = requiredEnv('GCP_SA_KEY_B64');

// -----------------------------
// Mongo (reuse connection)
// -----------------------------
const globalForMongo = globalThis as unknown as { _mongoClientPromise?: Promise<MongoClient> };
let clientPromise: Promise<MongoClient>;

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
// GCS client (service account from base64 JSON)
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

// -----------------------------
// Helpers
// -----------------------------
function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

type GcsRef = { bucket: string; objectPath: string };

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>[?query]
 *  - gs://<bucket>/<object>
 *  - <object> (object path only; assumes default bucket)
 *  - signed GCS URL (same as storage.googleapis.com URL with query)
 */
function parseGcsObjectRef(value: string): GcsRef | null {
  if (!value) return null;

  // Strip querystring (signed URLs)
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

type DeleteResult =
  | { deleted: true; bucket: string; objectPath: string }
  | { deleted: false; reason: 'no_ref' | 'invalid_input'; bucket?: string; objectPath?: string; error?: string };

async function deleteIfPresent(maybeUrlOrPath: unknown): Promise<DeleteResult> {
  if (typeof maybeUrlOrPath !== 'string' || !maybeUrlOrPath.trim()) {
    return { deleted: false, reason: 'invalid_input' };
  }

  const ref = parseGcsObjectRef(maybeUrlOrPath.trim());
  if (!ref) return { deleted: false, reason: 'no_ref' };

  try {
    await storage.bucket(ref.bucket).file(ref.objectPath).delete({ ignoreNotFound: true });
    return { deleted: true, bucket: ref.bucket, objectPath: ref.objectPath };
  } catch (err: unknown) {
    return {
      deleted: false,
      reason: 'no_ref',
      bucket: ref.bucket,
      objectPath: ref.objectPath,
      error: getErrorMessage(err),
    };
  }
}

// -----------------------------
// Route handlers
// -----------------------------
export async function OPTIONS() {
  const headers = setCORSHeaders();
  return new NextResponse(null, { status: 204, headers });
}

/**
 * DELETE /api/deleteimage?id=<mongoId>&userId=<optional>&collection=<optional>
 *
 * Default collection is "svgdata".
 * If userId is provided, it will be enforced in the DB query.
 * The route will:
 *  1) Find the record
 *  2) Delete associated GCS files (pngData, svgData, simplifiedSvgData if present)
 *  3) Delete the DB record
 */
export async function DELETE(request: Request) {
  const headers = setCORSHeaders();

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId') || null;
    const collectionName = searchParams.get('collection') || 'svgdata';

    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Valid id is required' }, { status: 400, headers });
    }

    const objectId = new ObjectId(id);

    const client = await clientPromise;

    // NOTE: if you want this configurable, use requiredEnv('MONGODB_DB') instead of hardcoding
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection(collectionName);

    const findQuery = userId ? { _id: objectId, userId } : { _id: objectId };
    const doc = await collection.findOne(findQuery);

    if (!doc) {
      return NextResponse.json({ error: 'Record not found in database' }, { status: 404, headers });
    }

    type DeleteTargetKey = 'pngData' | 'svgData' | 'simplifiedSvgData';
    const deleteTargets: Array<{ key: DeleteTargetKey; value: unknown }> = [];

    if ((doc as any).pngData) deleteTargets.push({ key: 'pngData', value: (doc as any).pngData });
    if ((doc as any).svgData) deleteTargets.push({ key: 'svgData', value: (doc as any).svgData });
    if ((doc as any).simplifiedSvgData)
      deleteTargets.push({ key: 'simplifiedSvgData', value: (doc as any).simplifiedSvgData });

    const deletedFiles: Partial<Record<DeleteTargetKey, DeleteResult>> = {};
    for (const t of deleteTargets) {
      deletedFiles[t.key] = await deleteIfPresent(t.value);
    }

    const deleteQuery = userId ? { _id: objectId, userId } : { _id: objectId };
    const result = await collection.deleteOne(deleteQuery);

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Record not deleted (race condition)' }, { status: 409, headers });
    }

    return NextResponse.json({ message: 'Record deleted successfully', deletedFiles }, { status: 200, headers });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: 'Failed to delete record or file', details: getErrorMessage(error) },
      { status: 500, headers }
    );
  }
}
