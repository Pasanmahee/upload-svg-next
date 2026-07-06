import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getUidIfPresent } from '@/lib/auth';
import { ensureAndSeedPacks, getDownloadedPackState, getOwnedPackIds, serializePack } from '@/lib/packs';

export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  Vary: 'Authorization',
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

export async function GET(request: Request) {
  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);

    const uid = await getUidIfPresent(request);
    const ownedPackIds = await getOwnedPackIds(db, uid);
    const downloadedState = await getDownloadedPackState(db, uid);
    const packs = await db.collection('packs')
      .find({ isActive: { $ne: false } })
      .sort({ sortOrder: 1, title: 1 })
      .toArray();

    return json({
      success: true,
      signedIn: Boolean(uid),
      packs: packs.map((pack: any) => serializePack(pack, ownedPackIds, downloadedState.get(String(pack.packId || '')))),
    });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 500);
  }
}
