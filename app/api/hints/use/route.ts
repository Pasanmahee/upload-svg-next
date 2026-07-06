/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import {
  cleanSafeId,
  ensureHintIndexes,
  getHintEconomyConfig,
  normalizeDailyReward,
  normalizeHintEconomy,
  parseHintType,
  publicHintStatus,
  todayKey,
} from '@/lib/hints';

export const runtime = 'nodejs';

type SpendSource = 'free' | 'coins';

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

function cleanOptionalText(value: unknown, maxLength = 40): string | null {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return null;
  return cleaned.replace(/[^A-Za-z0-9:_./-]/g, '-').slice(0, maxLength) || null;
}

function cleanOptionalCount(value: unknown): number | null {
  const count = Number(value);
  if (!Number.isFinite(count)) return null;
  return Math.max(0, Math.min(9999, Math.floor(count)));
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
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const type = parseHintType(body?.type);
    const imageId = cleanSafeId(body?.imageId, 'imageId', 160);
    const levelId = cleanSafeId(body?.levelId, 'levelId', 80);
    const clientHintId = cleanSafeId(body?.clientHintId ?? body?.idempotencyKey, 'clientHintId', 120);
    const targetNumber = cleanOptionalText(body?.targetNumber, 40);
    const targetFacetCount = cleanOptionalCount(body?.targetFacetCount);
    const config = getHintEconomyConfig();
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureHintIndexes(db);

    const users = db.collection<any>('users');
    const events = db.collection<any>('hintEvents');
    const now = new Date();

    if (clientHintId) {
      const duplicate = await events.findOne({ userId: auth.uid, clientHintId });
      if (duplicate) {
        const userDoc = await users.findOne({ _id: auth.uid }, { projection: { hintEconomy: 1, dailyReward: 1 } });
        return json({
          success: true,
          duplicate: true,
          spent: false,
          hint: {
            type: duplicate.type || type,
            spendSource: duplicate.spendSource || null,
            coinsSpent: Number(duplicate.coinsSpent || 0),
            imageId: duplicate.imageId || imageId,
            levelId: duplicate.levelId || levelId,
            targetNumber: duplicate.targetNumber || targetNumber,
            targetFacetCount: duplicate.targetFacetCount ?? targetFacetCount,
          },
          status: publicHintStatus(userDoc, !auth.isAnonymous, !!auth.isAnonymous, config),
        });
      }
    }

    const userDoc = await users.findOne({ _id: auth.uid }, { projection: { hintEconomy: 1, dailyReward: 1 } });
    const economy = normalizeHintEconomy(userDoc?.hintEconomy, config);
    const reward = normalizeDailyReward(userDoc?.dailyReward);
    const today = todayKey();

    let spendSource: SpendSource | null = null;
    let coinsSpent = 0;
    let nextFreeHints = economy.freeHints;
    let nextCoins = reward.coins;

    if (nextFreeHints > 0) {
      spendSource = 'free';
      nextFreeHints -= 1;
    } else if (config.coinCost === 0 || nextCoins >= config.coinCost) {
      spendSource = 'coins';
      coinsSpent = config.coinCost;
      nextCoins = Math.max(0, nextCoins - config.coinCost);
    } else {
      return json({
        error: 'Not enough hints or coins.',
        code: 'INSUFFICIENT_HINT_BALANCE',
        requiredCoins: config.coinCost,
        status: publicHintStatus(userDoc, !auth.isAnonymous, !!auth.isAnonymous, config),
      }, 402);
    }

    const nextEconomy = {
      ...economy,
      freeHints: nextFreeHints,
      lifetimeUsed: economy.lifetimeUsed + 1,
      daily: {
        ...economy.daily,
        lastUseDate: today,
        usedToday: economy.daily.lastUseDate === today ? economy.daily.usedToday + 1 : 1,
      },
    };
    const nextReward = { ...reward, coins: nextCoins };

    const eventDoc = {
      userId: auth.uid,
      userEmail: auth.email || null,
      eventType: 'use',
      type,
      imageId,
      levelId,
      clientHintId,
      targetNumber,
      targetFacetCount,
      spendSource,
      coinsSpent,
      dateKey: today,
      createdAt: now,
    };

    await users.updateOne(
      { _id: auth.uid },
      {
        $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now },
        $set: { hintEconomy: nextEconomy, dailyReward: nextReward, updatedAt: now },
      },
      { upsert: true }
    );

    await events.insertOne(eventDoc);

    const nextDoc = await users.findOne({ _id: auth.uid }, { projection: { hintEconomy: 1, dailyReward: 1 } });
    return json({
      success: true,
      duplicate: false,
      spent: true,
      hint: { type, spendSource, coinsSpent, imageId, levelId, targetNumber, targetFacetCount },
      status: publicHintStatus(nextDoc, !auth.isAnonymous, !!auth.isAnonymous, config),
    });
  } catch (e) {
    const message = getErrorMessage(e);
    const validation = /required|must be|unsupported|too long|characters/i.test(message);
    return json({ error: validation ? message : 'Failed to use hint', details: validation ? undefined : message }, validation ? 400 : 500);
  }
}
