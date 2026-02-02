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
// GCS client (service account from base64 JSON)
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

/**
 * Accepts:
 *  - https://storage.googleapis.com/<bucket>/<object>[?query]
 *  - gs://<bucket>/<object>
 *  - <object> (object path only; assumes default bucket)
 *  - signed GCS URL (same as storage.googleapis.com URL with query)
 */
function parseGcsObjectRef(value) {
  if (!value || typeof value !== 'string') return null;

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

async function deleteIfPresent(maybeUrlOrPath) {
  const ref = parseGcsObjectRef(maybeUrlOrPath);
  if (!ref) return { deleted: false, reason: 'no_ref' };

  try {
    await storage.bucket(ref.bucket).file(ref.objectPath).delete({ ignoreNotFound: true });
    return { deleted: true, bucket: ref.bucket, objectPath: ref.objectPath };
  } catch (err) {
    return { deleted: false, bucket: ref.bucket, objectPath: ref.objectPath, error: String(err?.message || err) };
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
export async function DELETE(request) {
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
    const database = client.db('svgfacetpaintbynumber');
    const collection = database.collection(collectionName);

    const findQuery = userId ? { _id: objectId, userId } : { _id: objectId };
    const doc = await collection.findOne(findQuery);

    if (!doc) {
      return NextResponse.json({ error: 'Record not found in database' }, { status: 404, headers });
    }

    // Delete GCS objects referenced by the document
    const deleteTargets = [];
    if (doc.pngData) deleteTargets.push({ key: 'pngData', value: doc.pngData });
    if (doc.svgData) deleteTargets.push({ key: 'svgData', value: doc.svgData });
    if (doc.simplifiedSvgData) deleteTargets.push({ key: 'simplifiedSvgData', value: doc.simplifiedSvgData });

    const deletedFiles = {};
    for (const t of deleteTargets) {
      deletedFiles[t.key] = await deleteIfPresent(t.value);
    }

    // Delete DB record
    const deleteQuery = userId ? { _id: objectId, userId } : { _id: objectId };
    const result = await collection.deleteOne(deleteQuery);

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Record not deleted (race condition)' }, { status: 409, headers });
    }

    return NextResponse.json(
      { message: 'Record deleted successfully', deletedFiles },
      { status: 200, headers }
    );
  } catch (error) {
    console.error('Error deleting record or file:', error);
    return NextResponse.json(
      { error: 'Failed to delete record or file', details: String(error?.message || error) },
      { status: 500, headers }
    );
  }
}
