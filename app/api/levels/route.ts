/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { GAME_LEVELS, normalizeLevelProgress } from '@/lib/levelSystem';

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function GET(request: Request) {
  try {
    const auth = await verifyFirebaseAuth(request);
    let progress = normalizeLevelProgress(null);

    if (auth.ok) {
      const client = await getMongoClient();
      const db = client.db(getDbName());
      const users = db.collection('users');
      const userDoc = await users.findOne({ _id: auth.uid }, { projection: { levelProgress: 1 } });
      progress = normalizeLevelProgress(userDoc?.levelProgress);
    }

    return json({
      levels: GAME_LEVELS,
      progress: {
        signedIn: auth.ok,
        ...progress,
      },
    });
  } catch (e: any) {
    return json({ error: 'Failed to load levels', details: e?.message || String(e) }, 500);
  }
}
