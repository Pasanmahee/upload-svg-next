/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { calculateUnlockedLevels, normalizeLevelProgress } from '@/lib/levelSystem';
import { getGameConfig } from '@/lib/gameConfig';

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

function uniqueStrings(values: any[], max = 5000): string[] {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((x: any) => String(x || '').trim())
    .filter(Boolean)))
    .slice(0, max);
}

function normalizeDailyReward(raw: any) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    coins: Number.isFinite(Number(source.coins)) ? Math.max(0, Math.floor(Number(source.coins))) : 0,
    streak: Number.isFinite(Number(source.streak)) ? Math.max(0, Math.floor(Number(source.streak))) : 0,
    lastClaimDate: typeof source.lastClaimDate === 'string' ? source.lastClaimDate.slice(0, 10) : null,
    claimedDates: uniqueStrings(source.claimedDates, 120)
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
      .sort(),
    unlockedSpecialPacks: uniqueStrings(source.unlockedSpecialPacks, 100),
  };
}

function mergeDailyReward(serverRaw: any, localRaw: any) {
  const server = normalizeDailyReward(serverRaw);
  const local = normalizeDailyReward(localRaw);
  const claimedDates = Array.from(new Set([...server.claimedDates, ...local.claimedDates])).sort().slice(-120);
  const unlockedSpecialPacks = Array.from(new Set([...server.unlockedSpecialPacks, ...local.unlockedSpecialPacks]));
  const lastClaimDate = [server.lastClaimDate, local.lastClaimDate, claimedDates[claimedDates.length - 1] || null]
    .filter((x): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x))
    .sort()
    .pop() || null;

  return {
    coins: Math.max(server.coins, local.coins),
    streak: Math.max(server.streak, local.streak),
    lastClaimDate,
    claimedDates,
    unlockedSpecialPacks,
  };
}

export async function POST(request: Request) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  // Cloud sync is intended for real accounts. Anonymous users can already save
  // progress through the normal endpoints under their temporary UID, but they
  // should not be treated as permanent cloud-backup accounts.
  if (!!auth.isAnonymous) {
    return json({ error: 'Sign in with Google or email to save progress to your account.' }, 403);
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const config = await getGameConfig(db);
    const users = db.collection<any>('users');
    const now = new Date();

    const userDoc = await users.findOne({ _id: auth.uid }, { projection: { levelProgress: 1, dailyReward: 1 } });

    const serverProgress = normalizeLevelProgress(userDoc?.levelProgress, config.levels);
    const localProgress = normalizeLevelProgress(body?.levelProgress, config.levels);
    const mergedCompleted: Record<string, string[]> = {};

    for (const level of config.levels) {
      const serverItems = Array.isArray(serverProgress.completedImagesByLevel?.[level.id]) ? serverProgress.completedImagesByLevel[level.id] : [];
      const localItems = Array.isArray(localProgress.completedImagesByLevel?.[level.id]) ? localProgress.completedImagesByLevel[level.id] : [];
      mergedCompleted[level.id] = uniqueStrings([...serverItems, ...localItems]);
    }

    const mergedProgress = calculateUnlockedLevels({
      completedImagesByLevel: mergedCompleted,
      unlockedLevelIds: uniqueStrings([...(serverProgress.unlockedLevelIds || []), ...(localProgress.unlockedLevelIds || [])]),
      lastCompletedLevelId: localProgress.lastCompletedLevelId || serverProgress.lastCompletedLevelId || null,
    }, config.levels);

    const mergedDailyReward = mergeDailyReward(userDoc?.dailyReward, body?.dailyReward);

    await users.updateOne(
      { _id: auth.uid },
      {
        $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now },
        $set: {
          updatedAt: now,
          levelProgress: mergedProgress,
          dailyReward: mergedDailyReward,
        },
      },
      { upsert: true },
    );

    return json({
      success: true,
      message: 'Progress saved to your account.',
      levelProgress: mergedProgress,
      dailyReward: mergedDailyReward,
    });
  } catch (e: any) {
    return json({ error: 'Failed to sync progress', details: e?.message || String(e) }, 500);
  }
}
