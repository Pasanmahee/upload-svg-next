import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { cleanPackId, ensurePackIndexes } from '@/lib/packs';

export const runtime = 'nodejs';
const CORS_HEADERS: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store', Vary: 'Authorization' };
function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: CORS_HEADERS }); }
function getErrorMessage(err: unknown): string { if (err instanceof Error) return err.message; if (typeof err === 'string') return err; try { return JSON.stringify(err); } catch { return 'Unknown error'; } }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS_HEADERS }); }

export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const { packId: rawPackId } = await ctx.params;
    const packId = cleanPackId(rawPackId);
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensurePackIndexes(db);
    const now = new Date();
    await db.collection('packDownloads').insertOne({ userId: auth.uid, userEmail: auth.email || null, packId, action: 'deleted', createdAt: now });
    return json({ success: true, downloaded: false, packId, deletedAt: now.toISOString() });
  } catch (err) {
    return json({ success: false, error: getErrorMessage(err) }, 500);
  }
}
