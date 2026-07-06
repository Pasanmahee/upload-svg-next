/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyAdminAuth } from '@/lib/auth';
import {
  ensureHintIndexes,
  getHintEconomyConfig,
  normalizeDailyReward,
  normalizeHintEconomy,
  publicHintStatus,
  todayKey,
} from '@/lib/hints';

export const runtime = 'nodejs';

type UserLookup = { query: Record<string, unknown>; label: string };

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email',
    'Cache-Control': 'no-store',
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: headers() });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function cleanText(value: unknown, maxLength = 180): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), min), max);
}

function userLookupFromParams(params: URLSearchParams): UserLookup | null {
  const userId = cleanText(params.get('userId') || params.get('uid'));
  const email = cleanText(params.get('email')).toLowerCase();
  return userLookupFromValues(userId, email);
}

function userLookupFromValues(userId: unknown, email: unknown): UserLookup | null {
  const cleanedUserId = cleanText(userId);
  const cleanedEmail = cleanText(email).toLowerCase();

  if (cleanedUserId) {
    return { query: { $or: [{ _id: cleanedUserId }, { uid: cleanedUserId }] }, label: cleanedUserId };
  }

  if (cleanedEmail && cleanedEmail.includes('@')) {
    return {
      query: {
        $or: [
          { email: cleanedEmail },
          { userEmail: cleanedEmail },
          { parentEmail: cleanedEmail },
          { 'profile.email': cleanedEmail },
        ],
      },
      label: cleanedEmail,
    };
  }

  return null;
}

function publicAdminUser(doc: any, config = getHintEconomyConfig()) {
  const hintEconomy = normalizeHintEconomy(doc?.hintEconomy, config);
  const dailyReward = normalizeDailyReward(doc?.dailyReward);
  return {
    id: String(doc?._id || doc?.uid || ''),
    uid: doc?.uid || doc?._id || null,
    email: doc?.email || doc?.userEmail || doc?.parentEmail || doc?.profile?.email || null,
    playerName: doc?.playerName || doc?.name || doc?.profile?.name || null,
    createdAt: doc?.createdAt || null,
    updatedAt: doc?.updatedAt || null,
    hintEconomy,
    dailyReward,
    hintStatus: publicHintStatus(doc, true, false, config),
  };
}

function resetTodayFromEconomy(rawEconomy: any, config = getHintEconomyConfig()) {
  const economy = normalizeHintEconomy(rawEconomy, config);
  const today = todayKey();
  return {
    ...economy,
    freeHints: config.dailyFreeHints,
    daily: {
      ...economy.daily,
      lastClaimDate: economy.daily.lastClaimDate === today ? null : economy.daily.lastClaimDate,
      claimedDates: economy.daily.claimedDates.filter((date: string) => date !== today),
      lastUseDate: economy.daily.lastUseDate === today ? null : economy.daily.lastUseDate,
      usedToday: 0,
    },
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function GET(request: Request) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  try {
    const url = new URL(request.url);
    const lookup = userLookupFromParams(url.searchParams);
    if (!lookup) {
      return json({ error: 'Provide userId/uid or email to load hint test data.' }, 400);
    }

    const config = getHintEconomyConfig();
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureHintIndexes(db);

    const userDoc = await db.collection<any>('users').findOne(lookup.query);
    if (!userDoc) {
      return json({ error: `No user found for ${lookup.label}. Use Firebase UID for the most reliable lookup.` }, 404);
    }

    const events = await db.collection<any>('hintEvents')
      .find({ userId: userDoc._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .project({ _id: 0, userId: 0 })
      .toArray();

    return json({ ok: true, config, user: publicAdminUser(userDoc, config), recentHintEvents: events });
  } catch (err: unknown) {
    return json({ error: 'Failed to load user hint test data', details: getErrorMessage(err) }, 500);
  }
}

export async function PATCH(request: Request) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const lookup = userLookupFromValues(body?.userId ?? body?.uid, body?.email);
    if (!lookup) {
      return json({ error: 'Provide userId/uid or email.' }, 400);
    }

    const config = getHintEconomyConfig();
    const client = await getMongoClient();
    const db = client.db(getDbName());
    await ensureHintIndexes(db);

    const users = db.collection<any>('users');
    const userDoc = await users.findOne(lookup.query);
    if (!userDoc) {
      return json({ error: `No user found for ${lookup.label}.` }, 404);
    }

    const now = new Date();
    let nextEconomy = normalizeHintEconomy(userDoc.hintEconomy, config);
    let nextReward = normalizeDailyReward(userDoc.dailyReward);
    const action = String(body?.action || '').trim().toLowerCase();

    if (action === 'reset' || body?.resetHints === true) {
      nextEconomy = resetTodayFromEconomy(userDoc.hintEconomy, config);
    }

    if (body?.freeHints !== undefined && body?.freeHints !== null && body?.freeHints !== '') {
      nextEconomy = {
        ...nextEconomy,
        freeHints: clampInt(body.freeHints, nextEconomy.freeHints, 0, config.maxStoredFreeHints),
      };
    }

    if (body?.coins !== undefined && body?.coins !== null && body?.coins !== '') {
      nextReward = {
        ...nextReward,
        coins: clampInt(body.coins, nextReward.coins, 0, 999999999),
      };
    }

    if (body?.clearDailyClaim === true) {
      const today = todayKey();
      nextEconomy = {
        ...nextEconomy,
        daily: {
          ...nextEconomy.daily,
          lastClaimDate: nextEconomy.daily.lastClaimDate === today ? null : nextEconomy.daily.lastClaimDate,
          claimedDates: nextEconomy.daily.claimedDates.filter((date: string) => date !== today),
        },
      };
    }

    if (body?.clearDailyUse === true) {
      const today = todayKey();
      nextEconomy = {
        ...nextEconomy,
        daily: {
          ...nextEconomy.daily,
          lastUseDate: nextEconomy.daily.lastUseDate === today ? null : nextEconomy.daily.lastUseDate,
          usedToday: 0,
        },
      };
    }

    await users.updateOne(
      { _id: userDoc._id },
      {
        $set: {
          hintEconomy: nextEconomy,
          dailyReward: nextReward,
          updatedAt: now,
          lastHintTestUpdatedAt: now,
          lastHintTestUpdatedBy: admin.email,
        },
      }
    );

    await db.collection<any>('hintEvents').insertOne({
      userId: userDoc._id,
      eventType: action === 'reset' || body?.resetHints === true ? 'admin_reset' : 'admin_edit',
      freeHints: nextEconomy.freeHints,
      coins: nextReward.coins,
      adminEmail: admin.email,
      createdAt: now,
      dateKey: todayKey(),
    });

    const nextDoc = await users.findOne({ _id: userDoc._id });
    return json({ ok: true, config, user: publicAdminUser(nextDoc, config) });
  } catch (err: unknown) {
    return json({ error: 'Failed to update hint test data', details: getErrorMessage(err) }, 500);
  }
}
