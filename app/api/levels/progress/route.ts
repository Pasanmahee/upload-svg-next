/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { GAME_LEVELS, calculateUnlockedLevels, getLevelById, isValidLevelId, normalizeLevelProgress } from '@/lib/levelSystem';

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function POST(request: Request) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const levelId = String(body?.levelId || '').trim();
  const imageId = String(body?.imageId || '').trim();

  if (!isValidLevelId(levelId)) return json({ error: 'Invalid level id.' }, 400);
  if (!ObjectId.isValid(imageId)) return json({ error: 'Invalid image id.' }, 400);

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const users = db.collection('users');

    const now = new Date();
    const userDoc = await users.findOne({ _id: auth.uid }, { projection: { levelProgress: 1 } });
    const before = normalizeLevelProgress(userDoc?.levelProgress);
    const beforeUnlocked = new Set(before.unlockedLevelIds || ['beginner']);

    const byLevel = { ...(before.completedImagesByLevel || {}) };
    const current = Array.isArray(byLevel[levelId]) ? byLevel[levelId] : [];
    byLevel[levelId] = Array.from(new Set([...current, imageId]));

    const progress = calculateUnlockedLevels({
      completedImagesByLevel: byLevel,
      unlockedLevelIds: before.unlockedLevelIds,
      lastCompletedLevelId: levelId,
    });

    await users.updateOne(
      { _id: auth.uid },
      {
        $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now },
        $set: {
          updatedAt: now,
          levelProgress: progress,
        },
      },
      { upsert: true },
    );

    const newlyUnlocked = (progress.unlockedLevelIds || []).find((id: string) => !beforeUnlocked.has(id));
    const unlockedLevel = newlyUnlocked ? getLevelById(newlyUnlocked) : null;

    return json({
      success: true,
      levelId,
      imageId,
      progress: {
        signedIn: true,
        ...progress,
      },
      unlockedLevel,
      levels: GAME_LEVELS,
    });
  } catch (e: any) {
    return json({ error: 'Failed to save level progress', details: e?.message || String(e) }, 500);
  }
}
