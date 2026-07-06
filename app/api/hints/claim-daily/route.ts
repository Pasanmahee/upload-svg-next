/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { ensureHintIndexes, getHintEconomyConfig, normalizeHintEconomy, publicHintStatus, todayKey } from '@/lib/hints';

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
  try { return JSON.stringify(e); } catch { return 'Unknown error'; }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function POST(request: Request) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  try {
    const config = getHintEconomyConfig();
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureHintIndexes(db);

    const users = db.collection<any>('users');
    const userDoc = await users.findOne({ _id: auth.uid }, { projection: { hintEconomy: 1, dailyReward: 1 } });
    const economy = normalizeHintEconomy(userDoc?.hintEconomy, config);
    const today = todayKey();
    const alreadyClaimed = economy.daily.claimedDates.includes(today) || economy.daily.lastClaimDate === today;
    const now = new Date();

    if (alreadyClaimed || config.dailyFreeHints <= 0) {
      return json({
        success: true,
        alreadyClaimed: true,
        grantedHints: 0,
        status: publicHintStatus(userDoc, !auth.isAnonymous, !!auth.isAnonymous, config),
      });
    }

    const grantRoom = Math.max(0, config.maxStoredFreeHints - economy.freeHints);
    const grantedHints = Math.min(config.dailyFreeHints, grantRoom);
    const nextEconomy = {
      ...economy,
      freeHints: Math.min(config.maxStoredFreeHints, economy.freeHints + grantedHints),
      lifetimeClaimed: economy.lifetimeClaimed + grantedHints,
      daily: {
        ...economy.daily,
        lastClaimDate: today,
        claimedDates: Array.from(new Set([...economy.daily.claimedDates.slice(-119), today])).sort(),
      },
    };

    await users.updateOne(
      { _id: auth.uid },
      {
        $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now },
        $set: { hintEconomy: nextEconomy, updatedAt: now },
      },
      { upsert: true }
    );

    await db.collection<any>('hintEvents').insertOne({
      userId: auth.uid,
      eventType: 'daily_claim',
      grantedHints,
      dateKey: today,
      createdAt: now,
    });

    const nextDoc = await users.findOne({ _id: auth.uid }, { projection: { hintEconomy: 1, dailyReward: 1 } });
    return json({
      success: true,
      alreadyClaimed: false,
      grantedHints,
      status: publicHintStatus(nextDoc, !auth.isAnonymous, !!auth.isAnonymous, config),
    });
  } catch (e) {
    return json({ error: 'Failed to claim daily hints', details: getErrorMessage(e) }, 500);
  }
}
