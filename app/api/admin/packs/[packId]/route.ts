import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyAdminAuth } from '@/lib/auth';
import { cleanPackId, cleanText, ensureAndSeedPacks, normalizeImageIds, normalizePackType, parseNonNegativeInt, serializePack } from '@/lib/packs';

export const runtime = 'nodejs';
const CORS_HEADERS: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email', 'Cache-Control': 'no-store' };
function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: CORS_HEADERS }); }
function getErrorMessage(err: unknown): string { if (err instanceof Error) return err.message; if (typeof err === 'string') return err; try { return JSON.stringify(err); } catch { return 'Unknown error'; } }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS_HEADERS }); }

export async function GET(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ success: false, error: admin.error }, admin.status);
  try {
    const { packId: rawPackId } = await ctx.params;
    const packId = cleanPackId(rawPackId);
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);
    const pack = await db.collection('packs').findOne({ packId });
    if (!pack) return json({ success: false, error: 'Pack not found.' }, 404);
    return json({ success: true, pack: { ...serializePack(pack), imageIds: Array.isArray((pack as any)?.imageIds) ? (pack as any).imageIds : [] } });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 500);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ success: false, error: admin.error }, admin.status);
  try {
    const { packId: rawPackId } = await ctx.params;
    const packId = cleanPackId(rawPackId);
    const body = await request.json().catch(() => ({}));
    const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: admin.email };
    if ('title' in body) set.title = cleanText(body.title, 120);
    if ('description' in body) set.description = cleanText(body.description, 500);
    if ('coverImageUrl' in body) set.coverImageUrl = cleanText(body.coverImageUrl, 1000) || null;
    if ('type' in body) set.type = normalizePackType(body.type);
    if ('priceCoins' in body) set.priceCoins = parseNonNegativeInt(body.priceCoins, 0, 1_000_000);
    if ('requiredStreak' in body) set.requiredStreak = body.requiredStreak == null ? null : parseNonNegativeInt(body.requiredStreak, 0, 3650);
    if ('requiredAchievementId' in body) set.requiredAchievementId = cleanText(body.requiredAchievementId, 120) || null;
    if ('imageIds' in body) set.imageIds = normalizeImageIds(body.imageIds);
    if ('manifestUrl' in body) set.manifestUrl = cleanText(body.manifestUrl, 1000) || null;
    if ('manifestVersion' in body) set.manifestVersion = parseNonNegativeInt(body.manifestVersion, 1, 999999);
    if ('sizeBytes' in body) set.sizeBytes = parseNonNegativeInt(body.sizeBytes, 0, Number.MAX_SAFE_INTEGER);
    if ('sortOrder' in body) set.sortOrder = parseNonNegativeInt(body.sortOrder, 100, 999999);
    if ('isActive' in body) set.isActive = body.isActive !== false;

    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);
    await db.collection('packs').updateOne({ packId }, { $set: set });
    const pack = await db.collection('packs').findOne({ packId });
    if (!pack) return json({ success: false, error: 'Pack not found.' }, 404);
    return json({ success: true, pack: { ...serializePack(pack), imageIds: Array.isArray((pack as any)?.imageIds) ? (pack as any).imageIds : [] } });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 400);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ success: false, error: admin.error }, admin.status);
  try {
    const { packId: rawPackId } = await ctx.params;
    const packId = cleanPackId(rawPackId);
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);
    await db.collection('packs').updateOne({ packId }, { $set: { isActive: false, updatedAt: new Date(), updatedBy: admin.email } });
    return json({ success: true, packId, isActive: false });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 500);
  }
}
