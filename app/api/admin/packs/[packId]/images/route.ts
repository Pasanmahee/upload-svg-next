import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyAdminAuth } from '@/lib/auth';
import { cleanPackId, ensureAndSeedPacks, normalizeImageIds, parseNonNegativeInt, serializePack } from '@/lib/packs';

export const runtime = 'nodejs';
const CORS_HEADERS: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email', 'Cache-Control': 'no-store' };
function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: CORS_HEADERS }); }
function getErrorMessage(err: unknown): string { if (err instanceof Error) return err.message; if (typeof err === 'string') return err; try { return JSON.stringify(err); } catch { return 'Unknown error'; } }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS_HEADERS }); }

export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ success: false, error: admin.error }, admin.status);
  try {
    const { packId: rawPackId } = await ctx.params;
    const packId = cleanPackId(rawPackId);
    const body = await request.json().catch(() => ({}));
    const imageIds = normalizeImageIds(body.imageIds);
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureAndSeedPacks(db);
    await db.collection('packs').updateOne(
      { packId },
      {
        $set: {
          imageIds,
          manifestVersion: parseNonNegativeInt(body.manifestVersion, Date.now(), Number.MAX_SAFE_INTEGER),
          updatedAt: new Date(),
          updatedBy: admin.email,
        },
      }
    );
    const pack = await db.collection('packs').findOne({ packId });
    if (!pack) return json({ success: false, error: 'Pack not found.' }, 404);
    return json({ success: true, pack: serializePack(pack) });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 400);
  }
}
