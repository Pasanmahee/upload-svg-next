import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyAdminAuth } from '@/lib/auth';
import {
  cleanPackId,
  ensureAndSeedPacks,
  getImageIdsForLevel,
  normalizeImageIds,
  normalizeLevelIds,
  parseNonNegativeInt,
  serializePack,
  withResolvedPackImages,
} from '@/lib/packs';

export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email',
  'Cache-Control': 'no-store',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return 'Unknown error'; }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ success: false, error: admin.error }, admin.status);

  try {
    const { packId: rawPackId } = await ctx.params;
    const packId = cleanPackId(rawPackId);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'map').toLowerCase();
    const levelId = normalizeLevelIds([body.levelId])[0];
    if (!levelId) return json({ success: false, error: 'levelId is required.' }, 400);

    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);

    const pack = await db.collection('packs').findOne({ packId });
    if (!pack) return json({ success: false, error: 'Pack not found.' }, 404);

    const currentImageIds = normalizeImageIds((pack as any).imageIds);
    const currentMappedLevels = normalizeLevelIds((pack as any).mappedLevelIds);
    const levelImageIds = await getImageIdsForLevel(db, levelId);
    const now = new Date();

    let nextImageIds = currentImageIds;
    let nextMappedLevelIds = currentMappedLevels;
    let message = '';

    if (action === 'unmap') {
      nextMappedLevelIds = currentMappedLevels.filter((id) => id !== levelId);
      if (body.removeImages === true) {
        const removeSet = new Set(levelImageIds);
        nextImageIds = currentImageIds.filter((id) => !removeSet.has(id));
      }
      message = body.removeImages === true
        ? `Unmapped ${levelId} and removed ${levelImageIds.length} current image(s) from this pack.`
        : `Unmapped ${levelId}. Existing manually selected images were kept.`;
    } else {
      nextMappedLevelIds = Array.from(new Set([...currentMappedLevels, levelId]));
      if (body.addImagesNow !== false) {
        nextImageIds = Array.from(new Set([...currentImageIds, ...levelImageIds]));
      }
      message = `Mapped ${levelId} to this pack${body.addImagesNow === false ? '' : ` and added ${levelImageIds.length} image(s)`}.`;
    }

    const set: Record<string, unknown> = {
      imageIds: nextImageIds,
      mappedLevelIds: nextMappedLevelIds,
      updatedAt: now,
      updatedBy: admin.email,
      manifestVersion: parseNonNegativeInt(body.manifestVersion, Date.now(), Number.MAX_SAFE_INTEGER),
    };

    if ('autoSyncLevelImages' in body) set.autoSyncLevelImages = body.autoSyncLevelImages === true;
    if (action === 'map' && !('autoSyncLevelImages' in body)) set.autoSyncLevelImages = true;

    await db.collection('packs').updateOne({ packId }, { $set: set });
    const updatedPack = await withResolvedPackImages(db, await db.collection('packs').findOne({ packId }));

    return json({
      success: true,
      message,
      levelId,
      levelImageCount: levelImageIds.length,
      pack: {
        ...serializePack(updatedPack),
        imageIds: Array.isArray((updatedPack as any)?.imageIds) ? (updatedPack as any).imageIds : [],
        resolvedImageIds: Array.isArray((updatedPack as any)?.resolvedImageIds) ? (updatedPack as any).resolvedImageIds : [],
      },
    });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 400);
  }
}
