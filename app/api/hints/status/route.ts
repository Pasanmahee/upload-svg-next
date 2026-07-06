/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { getHintEconomyConfig, publicHintStatus } from '@/lib/hints';

export const runtime = 'nodejs';

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    Vary: 'Authorization',
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: headers() });
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return 'Unknown error'; }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function GET(request: Request) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const userDoc = await db.collection<any>('users').findOne(
      { _id: auth.uid },
      { projection: { hintEconomy: 1, dailyReward: 1 } }
    );

    return json({
      success: true,
      status: publicHintStatus(userDoc, !auth.isAnonymous, !!auth.isAnonymous, getHintEconomyConfig()),
    });
  } catch (e) {
    return json({ error: 'Failed to load hint status', details: getErrorMessage(e) }, 500);
  }
}
