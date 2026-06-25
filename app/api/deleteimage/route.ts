/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { Storage } from '@google-cloud/storage';
import { isAdminEmail, verifyFirebaseAuth } from "@/lib/auth";

export const runtime = 'nodejs';

// Feature flag
function isDeleteApiDisabled(): boolean {
  const v = (process.env.DISABLE_DELETE_IMAGE_API || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}


// -----------------------------
// Env (server-only)
// -----------------------------
function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

// Required env vars (only needed when delete API is enabled)
const DELETE_API_DISABLED = isDeleteApiDisabled();

let defaultBucketName = '';
let storage: Storage | null = null;

// -----------------------------
// GCS client (service account from base64 JSON)
// -----------------------------
type GcpCreds = { project_id?: string; [k: string]: any };

if (!DELETE_API_DISABLED) {
  defaultBucketName = requiredEnv('GCS_BUCKET');
  const saKeyB64 = requiredEnv('GCP_SA_KEY_B64');

  let gcpCredentials: GcpCreds;
  try {
    const json = Buffer.from(saKeyB64, 'base64').toString('utf8');
    gcpCredentials = JSON.parse(json) as GcpCreds;
  } catch {
    throw new Error('Invalid GCP_SA_KEY_B64: expected base64-encoded service account JSON');
  }

  storage = new Storage({
    projectId: gcpCredentials.project_id,
    credentials: gcpCredentials as any,
  });
}

// -----------------------------
// Helpers
// -----------------------------
function setCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email',
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

function isValidUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(userId);
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
    if (!storage) {
      return { deleted: false, reason: 'no_ref', bucket: ref.bucket, objectPath: ref.objectPath, error: 'Delete disabled' };
    }
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

  if (DELETE_API_DISABLED) {
    return NextResponse.json({ error: 'Delete image disabled' }, { status: 503, headers });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const auth = await verifyFirebaseAuth(request);
    const uid = auth.ok ? auth.uid : null;
    const isAdmin = auth.ok && isAdminEmail(auth.email);
    const collectionName = searchParams.get('collection') || 'svgdata';

    const allowedCollections = new Set(['svgdata', 'createdata']);
    if (!allowedCollections.has(collectionName)) {
      return NextResponse.json({ error: 'Invalid collection' }, { status: 400, headers });
    }

    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Valid id is required' }, { status: 400, headers });
    }

    const objectId = new ObjectId(id);

    const client = await getMongoClient();

    // NOTE: if you want this configurable, use requiredEnv('MONGODB_DB') instead of hardcoding
    const database = client.db(getDbName());
    const collection = database.collection(collectionName);

    // Always fetch by id first, then enforce ownership/admin rules.
    const doc = await collection.findOne({ _id: objectId });

    if (!doc) {
      return NextResponse.json({ error: 'Record not found in database' }, { status: 404, headers });
    }

    // Ownership / access rules:
    // - Admin emails from ADMIN_EMAILS may delete any managed record.
    // - Non-admin users may delete only their own private records.
    if (!isAdmin) {
      if ((doc as any)?.userId && typeof (doc as any).userId === 'string') {
        if (!auth.ok) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
        }
        if (uid !== (doc as any).userId) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
        }
      } else {
        return NextResponse.json({ error: auth.ok ? 'Forbidden' : 'Unauthorized' }, { status: auth.ok ? 403 : 401, headers });
      }
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

    const deleteQuery = (doc as any)?.userId
      ? { _id: objectId, userId: (doc as any).userId }
      : { _id: objectId };
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