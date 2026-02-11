import { NextResponse } from 'next/server';
import { verifyFirebaseAuth } from '@/lib/auth';
import { getBucketName, getStorage } from '@/lib/gcs';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

// Short TTL to limit exposure if a signed URL leaks.
const SIGNED_UPLOAD_URL_TTL_MS =
  Number.parseInt(process.env.SIGNED_UPLOAD_URL_TTL_MS || '', 10) > 0
    ? Number.parseInt(process.env.SIGNED_UPLOAD_URL_TTL_MS || '', 10)
    : 10 * 60 * 1000; // 10 minutes

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/upload-urls
 * Returns signed V4 PUT URLs to upload a processed SVG + PNG directly to GCS.
 *
 * The client MUST:
 *  - Upload with PUT
 *  - Set the exact Content-Type shown in the response
 *
 * Response:
 * {
 *   bucket: string,
 *   svg: { objectPath: string, uploadUrl: string, contentType: string },
 *   png: { objectPath: string, uploadUrl: string, contentType: string },
 *   expiresAt: string
 * }
 */
export async function POST(request: Request) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const bucketName = getBucketName();
  const storage = getStorage();
  const bucket = storage.bucket(bucketName);

  const now = Date.now();
  const expires = new Date(now + SIGNED_UPLOAD_URL_TTL_MS);

  // Use a unique id per job to avoid collisions.
  const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${now}-${Math.floor(Math.random() * 1_000_000)}`;

  // Lock object paths to the user.
  const base = `users/${auth.uid}/${id}`;
  const svgObjectPath = `${base}/result.svg`;
  const pngObjectPath = `${base}/preview.png`;

  const svgContentType = 'image/svg+xml';
  const pngContentType = 'image/png';

  try {
    const [svgUploadUrl] = await bucket.file(svgObjectPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires,
      contentType: svgContentType,
    });

    const [pngUploadUrl] = await bucket.file(pngObjectPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires,
      contentType: pngContentType,
    });

    return json({
      bucket: bucketName,
      svg: { objectPath: svgObjectPath, uploadUrl: svgUploadUrl, contentType: svgContentType },
      png: { objectPath: pngObjectPath, uploadUrl: pngUploadUrl, contentType: pngContentType },
      expiresAt: expires.toISOString(),
    });
  } catch (e: any) {
    // Most common causes:
    // - Missing private_key in credentials (required to sign URLs)
    // - Wrong service account permissions
    // - Storage not configured / bucket missing
    return json(
      {
        error: 'Failed to create signed upload URLs',
        detail: e?.message || String(e),
        hint:
          'Ensure GCP credentials include a private_key (e.g., via GCP_SA_KEY_B64) and the bucket exists + service account has Storage Object Admin permissions.',
      },
      500
    );
  }
}
