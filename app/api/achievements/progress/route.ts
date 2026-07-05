/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { getGameConfig } from '@/lib/gameConfig';
import { updateUserAchievements } from '@/lib/achievements';

export const runtime = 'nodejs';

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function POST(request: Request) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  try {
    // The body is intentionally optional. The backend recalculates achievement
    // progress from stored completion events and levelProgress, so clients cannot
    // unlock achievements by sending arbitrary progress values.
    try {
      await request.json();
    } catch {
      // Empty body is accepted.
    }

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const config = await getGameConfig(db);
    const achievementState = await updateUserAchievements(db, auth.uid, config.levels);

    return json({
      success: true,
      signedIn: !auth.isAnonymous,
      isAnonymous: !!auth.isAnonymous,
      ...achievementState,
    });
  } catch (e) {
    return json({ error: 'Failed to update achievements', details: getErrorMessage(e) }, 500);
  }
}
