/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { normalizeLevelProgress } from '@/lib/levelSystem';
import { getGameConfig, publicGameConfig } from '@/lib/gameConfig';

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
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const rawConfig = await getGameConfig(db);
    const config = publicGameConfig(rawConfig, new URL(request.url).origin);
    let progress = normalizeLevelProgress(null, config.levels);

    if (auth.ok) {
      const users = db.collection<any>('users');
      const userDoc = await users.findOne({ _id: auth.uid }, { projection: { levelProgress: 1 } });
      progress = normalizeLevelProgress(userDoc?.levelProgress, config.levels);
    }

    return json({
      levels: config.levels,
      progress: {
        signedIn: auth.ok,
        ...progress,
      },
    });
  } catch (e: any) {
    return json({ error: 'Failed to load levels', details: e?.message || String(e) }, 500);
  }
}
