import { ObjectId } from 'mongodb';
import { logger } from '@/lib/logger';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage } from '@/lib/gcs';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function json(data: any, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
  });
}

function pathFromGcsUrl(url: string, bucketName: string): string | null {
  const prefix = `https://storage.googleapis.com/${bucketName}/`;
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

// Next.js 15+ passes params as a Promise ("Dynamic APIs are Asynchronous").
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ userId: string; recordId: string }> },
) {
  // ✅ Hard-disable via env flag
  const disabled =
    process.env.DISABLE_DELETE_IMAGE_API === '1' ||
    process.env.DISABLE_DELETE_IMAGE_API?.toLowerCase() === 'true';

  if (disabled) {
    // 503 + Retry-After is appropriate for temporary disable (MDN, 2025).
    return json(
      { error: 'Delete API is temporarily disabled.' },
      503,
      {
        'Retry-After': '3600',
        'Cache-Control': 'no-store',
      }
    );
  }

  const { userId: rawUserId, recordId } = await ctx.params;
  const userId = decodeURIComponent(rawUserId);

  try {
    if (!ObjectId.isValid(recordId)) {
      return json({ error: 'Invalid record ID.' }, 400);
    }

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const svgDataCollection = db.collection('svgdata');

    const _id = new ObjectId(recordId);
    const record = await svgDataCollection.findOne({ _id });

    if (!record) {
      return json({ error: 'Record not found.' }, 404);
    }

    // Best-effort delete files from GCS (if URLs match the expected bucket)
    const bucketName = getBucketName();
    const storage = getStorage();
    const bucket = storage.bucket(bucketName);

    const svgUrl: string | undefined = (record as any).svgData;
    const pngUrl: string | undefined = (record as any).pngData;

    const toDelete: string[] = [];
    if (typeof svgUrl === 'string') {
      const p = pathFromGcsUrl(svgUrl, bucketName);
      if (p) toDelete.push(p);
    }
    if (typeof pngUrl === 'string') {
      const p = pathFromGcsUrl(pngUrl, bucketName);
      if (p) toDelete.push(p);
    }

    for (const p of toDelete) {
      try {
        await bucket.file(p).delete();
      } catch (e: any) {
        // ignore missing files / permissions; record deletion should still proceed
        logger.error('Failed deleting GCS file', { userId, recordId, path: p, error: e?.message || e });
      }
    }

    const delRes = await svgDataCollection.deleteOne({ _id });
    if (!delRes.deletedCount) {
      return json({ error: 'Record could not be deleted.' }, 404);
    }

    logger.log('Deleted record', { userId, recordId });
    return json({ message: 'Record deleted successfully.' });
  } catch (e: any) {
    logger.error('Error deleting record', { userId, recordId, error: e?.message || e });
    return json({ error: 'An error occurred while deleting the record.' }, 500);
  }
}
