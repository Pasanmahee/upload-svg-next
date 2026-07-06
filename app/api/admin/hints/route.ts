/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import type { Db } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getFirebaseAuth } from '@/lib/firebaseAdmin';
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

type UserLookup = { query: Record<string, unknown>; label: string; email?: string | null; userId?: string | null };

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

function normalizeEmailText(value: unknown): string {
  const cleaned = cleanText(value, 254).toLowerCase();
  return cleaned.includes('@') ? cleaned : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emailFieldOrQueries(email: string): Array<Record<string, unknown>> {
  const exactCaseInsensitive = { $regex: `^${escapeRegExp(email)}$`, $options: 'i' };
  return [
    { email },
    { userEmail: email },
    { parentEmail: email },
    { 'profile.email': email },
    { firebaseEmail: email },
    { authEmail: email },
    { emailLower: email },
    { email: exactCaseInsensitive },
    { userEmail: exactCaseInsensitive },
    { parentEmail: exactCaseInsensitive },
    { 'profile.email': exactCaseInsensitive },
    { firebaseEmail: exactCaseInsensitive },
    { authEmail: exactCaseInsensitive },
    { emailLower: exactCaseInsensitive },
  ];
}

async function resolveFirebaseUidByEmail(email: string): Promise<string | null> {
  try {
    const user = await getFirebaseAuth().getUserByEmail(email);
    return user?.uid || null;
  } catch {
    return null;
  }
}

async function resolveUidFromActivity(db: Db, email: string): Promise<string | null> {
  const exactCaseInsensitive = { $regex: `^${escapeRegExp(email)}$`, $options: 'i' };
  const lookups: Array<{ collection: string; query: Record<string, unknown> }> = [
    { collection: 'completions', query: { userEmail: exactCaseInsensitive } },
    { collection: 'hintEvents', query: { userEmail: exactCaseInsensitive } },
    { collection: 'leaderboardScores', query: { userEmail: exactCaseInsensitive } },
    { collection: 'scores', query: { userEmail: exactCaseInsensitive } },
  ];

  for (const lookup of lookups) {
    try {
      const doc = await db.collection(lookup.collection).findOne(
        lookup.query,
        { projection: { userId: 1 } }
      );
      if (doc?.userId) return String(doc.userId);
    } catch {
      // Some collections may not exist in older deployments.
    }
  }

  return null;
}

async function findUserDocForLookup(db: Db, lookup: UserLookup): Promise<{ userDoc: any | null; resolvedUid: string | null; resolvedEmail: string | null }> {
  const users = db.collection<any>('users');
  const query = lookup.query || {};
  let userDoc = await users.findOne(query);
  if (userDoc) {
    return {
      userDoc,
      resolvedUid: String(userDoc._id || userDoc.uid || ''),
      resolvedEmail: normalizeEmailText(userDoc.email || userDoc.userEmail || userDoc.parentEmail || userDoc.profile?.email || userDoc.firebaseEmail || userDoc.authEmail) || null,
    };
  }

  const email = typeof lookup.email === 'string' ? lookup.email : null;
  if (!email) return { userDoc: null, resolvedUid: null, resolvedEmail: null };

  userDoc = await users.findOne({ $or: emailFieldOrQueries(email) });
  if (userDoc) {
    return {
      userDoc,
      resolvedUid: String(userDoc._id || userDoc.uid || ''),
      resolvedEmail: email,
    };
  }

  const activityUid = await resolveUidFromActivity(db, email);
  if (activityUid) {
    userDoc = await users.findOne({ $or: [{ _id: activityUid }, { uid: activityUid }] });
    if (userDoc) return { userDoc, resolvedUid: activityUid, resolvedEmail: email };
    return { userDoc: null, resolvedUid: activityUid, resolvedEmail: email };
  }

  const firebaseUid = await resolveFirebaseUidByEmail(email);
  if (firebaseUid) {
    userDoc = await users.findOne({ $or: [{ _id: firebaseUid }, { uid: firebaseUid }] });
    return { userDoc, resolvedUid: firebaseUid, resolvedEmail: email };
  }

  return { userDoc: null, resolvedUid: null, resolvedEmail: email };
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
  const cleanedEmail = normalizeEmailText(email);

  if (cleanedUserId) {
    return { query: { $or: [{ _id: cleanedUserId }, { uid: cleanedUserId }] }, label: cleanedUserId, userId: cleanedUserId };
  }

  if (cleanedEmail) {
    return {
      query: { $or: emailFieldOrQueries(cleanedEmail) },
      label: cleanedEmail,
      email: cleanedEmail,
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
    email: doc?.email || doc?.userEmail || doc?.parentEmail || doc?.profile?.email || doc?.firebaseEmail || doc?.authEmail || doc?.emailLower || null,
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

    const resolved = await findUserDocForLookup(db, lookup);
    let userDoc = resolved.userDoc;
    if (!userDoc && resolved.resolvedUid) {
      userDoc = {
        _id: resolved.resolvedUid,
        uid: resolved.resolvedUid,
        email: resolved.resolvedEmail,
        createdAt: null,
        updatedAt: null,
      };
    }
    if (!userDoc) {
      return json({ error: `No user found for ${lookup.label}. Try Firebase UID, or make sure this email belongs to a Firebase user.` }, 404);
    }

    const eventUserId = String(userDoc._id || userDoc.uid || resolved.resolvedUid || '');
    const events = await db.collection<any>('hintEvents')
      .find({ userId: eventUserId })
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
    const resolved = await findUserDocForLookup(db, lookup);
    let userDoc = resolved.userDoc;
    if (!userDoc && resolved.resolvedUid) {
      userDoc = {
        _id: resolved.resolvedUid,
        uid: resolved.resolvedUid,
        email: resolved.resolvedEmail,
        createdAt: new Date(),
        hintEconomy: null,
        dailyReward: null,
      };
    }
    if (!userDoc) {
      return json({ error: `No user found for ${lookup.label}. Try Firebase UID, or make sure this email belongs to a Firebase user.` }, 404);
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

    const targetUid = String(userDoc._id || userDoc.uid || resolved.resolvedUid || lookup.userId || '');
    const resolvedEmail = resolved.resolvedEmail || lookup.email || normalizeEmailText(userDoc.email || userDoc.userEmail || userDoc.parentEmail || userDoc.profile?.email || userDoc.firebaseEmail || userDoc.authEmail) || null;

    await users.updateOne(
      { _id: targetUid },
      {
        $setOnInsert: {
          _id: targetUid,
          uid: targetUid,
          createdAt: now,
        },
        $set: {
          ...(resolvedEmail ? { email: resolvedEmail, emailLower: resolvedEmail } : {}),
          hintEconomy: nextEconomy,
          dailyReward: nextReward,
          updatedAt: now,
          lastHintTestUpdatedAt: now,
          lastHintTestUpdatedBy: admin.email,
        },
      },
      { upsert: true }
    );

    await db.collection<any>('hintEvents').insertOne({
      userId: targetUid,
      userEmail: resolvedEmail,
      eventType: action === 'reset' || body?.resetHints === true ? 'admin_reset' : 'admin_edit',
      freeHints: nextEconomy.freeHints,
      coins: nextReward.coins,
      adminEmail: admin.email,
      createdAt: now,
      dateKey: todayKey(),
    });

    const nextDoc = await users.findOne({ _id: targetUid });
    return json({ ok: true, config, user: publicAdminUser(nextDoc, config) });
  } catch (err: unknown) {
    return json({ error: 'Failed to update hint test data', details: getErrorMessage(err) }, 500);
  }
}
