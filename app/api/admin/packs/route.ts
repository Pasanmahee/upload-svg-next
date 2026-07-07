import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyAdminAuth } from '@/lib/auth';
import { cleanPackId, cleanText, ensureAndSeedPacks, normalizeImageIds, normalizePackType, parseNonNegativeInt, serializePack } from '@/lib/packs';

export const runtime = 'nodejs';
const CORS_HEADERS: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email', 'Cache-Control': 'no-store' };
function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: CORS_HEADERS }); }
function getErrorMessage(err: unknown): string { if (err instanceof Error) return err.message; if (typeof err === 'string') return err; try { return JSON.stringify(err); } catch { return 'Unknown error'; } }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS_HEADERS }); }

export async function GET(request: Request) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ success: false, error: admin.error }, admin.status);
  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);
    const packs = await db.collection('packs').find({}).sort({ sortOrder: 1, title: 1 }).toArray();
    return json({ success: true, packs: packs.map((pack: any) => ({ ...serializePack(pack), imageIds: Array.isArray(pack?.imageIds) ? pack.imageIds : [] })) });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 500);
  }
}

export async function POST(request: Request) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ success: false, error: admin.error }, admin.status);
  try {
    const body = await request.json().catch(() => ({}));
    const packId = cleanPackId(body.packId || body.title);
    const now = new Date();
    const doc = {
      packId,
      title: cleanText(body.title, 120) || packId,
      description: cleanText(body.description, 500),
      coverImageUrl: cleanText(body.coverImageUrl, 1000) || null,
      type: normalizePackType(body.type),
      priceCoins: parseNonNegativeInt(body.priceCoins, 0, 1_000_000),
      requiredStreak: body.requiredStreak == null ? null : parseNonNegativeInt(body.requiredStreak, 0, 3650),
      requiredAchievementId: cleanText(body.requiredAchievementId, 120) || null,
      imageIds: normalizeImageIds(body.imageIds),
      manifestUrl: cleanText(body.manifestUrl, 1000) || null,
      manifestVersion: parseNonNegativeInt(body.manifestVersion, 1, 999999),
      sizeBytes: parseNonNegativeInt(body.sizeBytes, 0, Number.MAX_SAFE_INTEGER),
      isActive: body.isActive !== false,
      sortOrder: parseNonNegativeInt(body.sortOrder, 100, 999999),
      createdAt: now,
      updatedAt: now,
      createdBy: admin.email,
    };
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);
    await db.collection('packs').updateOne({ packId }, { $setOnInsert: { createdAt: now }, $set: doc }, { upsert: true });
    const pack = await db.collection('packs').findOne({ packId });
    return json({ success: true, pack: { ...serializePack(pack), imageIds: Array.isArray((pack as any)?.imageIds) ? (pack as any).imageIds : [] } });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 400);
  }
}
