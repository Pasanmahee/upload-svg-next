import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { canUnlockPack, cleanPackId, ensureAndSeedPacks, getDownloadedPackState, getOwnedPackIds, serializePack } from '@/lib/packs';

export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  Vary: 'Authorization',
};

function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: CORS_HEADERS }); }
function getErrorMessage(err: unknown): string { if (err instanceof Error) return err.message; if (typeof err === 'string') return err; try { return JSON.stringify(err); } catch { return 'Unknown error'; } }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS_HEADERS }); }

export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ success: false, error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const { packId: rawPackId } = await ctx.params;
    const packId = cleanPackId(rawPackId);
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);

    const pack = await db.collection('packs').findOne({ packId, isActive: { $ne: false } });
    if (!pack) return json({ success: false, error: 'Pack not found.' }, 404);

    const existing = await db.collection('packOwnership').findOne({ userId: auth.uid, packId });
    if (!existing) {
      const allowed = await canUnlockPack(db, auth.uid, pack, body);
      if (!allowed.ok) return json({ success: false, error: allowed.error }, allowed.status);

      const now = new Date();
      if (allowed.coinsToDeduct && allowed.coinsToDeduct > 0) {
        const result = await db.collection<any>('users').updateOne(
          { _id: auth.uid, coins: { $gte: allowed.coinsToDeduct } },
          { $inc: { coins: -allowed.coinsToDeduct }, $set: { updatedAt: now }, $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now } },
          { upsert: false }
        );
        if (!result.matchedCount) return json({ success: false, error: 'Not enough coins.' }, 402);
      }

      await db.collection('packOwnership').updateOne(
        { userId: auth.uid, packId },
        {
          $setOnInsert: {
            userId: auth.uid,
            userEmail: auth.email || null,
            packId,
            unlockType: allowed.unlockType,
            unlockedAt: now,
            expiresAt: null,
          },
          $set: { updatedAt: now },
        },
        { upsert: true }
      );
    }

    const ownedPackIds = await getOwnedPackIds(db, auth.uid);
    const downloadedState = await getDownloadedPackState(db, auth.uid);
    return json({ success: true, owned: true, pack: serializePack(pack, ownedPackIds, downloadedState.get(packId)) });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 500);
  }
}
