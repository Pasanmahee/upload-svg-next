/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { getBucketName, getStorage } from '@/lib/gcs';
import { verifyFirebaseAuth } from '@/lib/auth';
import { getGameConfig, getManualDailyImageId } from '@/lib/gameConfig';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

type GcsRef = { bucket: string; objectPath: string };

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Email',
    'Cache-Control': 'no-store',
    Vary: 'Authorization',
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
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

function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return todayKey(d);
}

function hashDateKey(dateKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseGcsObjectRef(value: unknown): GcsRef | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('data:')) return null;

  const noQuery = value.split('?')[0];

  if (noQuery.startsWith('gs://')) {
    const rest = noQuery.slice('gs://'.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    return bucket && objectPath ? { bucket, objectPath } : null;
  }

  const httpsPrefix = 'https://storage.googleapis.com/';
  if (noQuery.startsWith(httpsPrefix)) {
    const rest = noQuery.slice(httpsPrefix.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) return null;
    const bucket = rest.slice(0, firstSlash);
    const objectPath = rest.slice(firstSlash + 1);
    return bucket && objectPath ? { bucket, objectPath } : null;
  }

  if (noQuery.includes('://')) return null;
  const objectPath = noQuery.replace(/^\/+/, '');
  return objectPath ? { bucket: getBucketName(), objectPath } : null;
}

async function signReadUrl(maybeUrlOrPath: unknown): Promise<unknown> {
  const ref = parseGcsObjectRef(maybeUrlOrPath);
  if (!ref) return maybeUrlOrPath;

  try {
    const storage = getStorage();
    const [signedUrl] = await storage
      .bucket(ref.bucket)
      .file(ref.objectPath)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
    return signedUrl;
  } catch {
    return maybeUrlOrPath;
  }
}

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  try {
    if (typeof v?.toISOString === 'function') return v.toISOString();
  } catch {
    // ignore
  }
  return String(v);
}

function imageProjection() {
  return {
    _id: 1,
    pngData: 1,
    colors: 1,
    categories: 1,
    date: 1,
    createdAt: 1,
    levelId: 1,
    title: 1,
    name: 1,
  };
}

async function serializeDailyImage(doc: any) {
  if (!doc) return null;
  return {
    _id: doc._id?.toString?.() ?? String(doc._id ?? ''),
    pngData: await signReadUrl(doc.pngData),
    colors: Array.isArray(doc.colors) ? doc.colors : [],
    categories: Array.isArray(doc.categories) ? doc.categories : [],
    levelId: typeof doc.levelId === 'string' ? doc.levelId : null,
    title: typeof doc.title === 'string' ? doc.title : typeof doc.name === 'string' ? doc.name : null,
    date: toIso(doc.date || doc.createdAt),
  };
}

async function getDailyImage(db: any, challengeDate: string, manualImageId?: string | null) {
  const collection = db.collection('svgdata');
  const baseQuery = { userId: { $exists: false } };

  if (manualImageId && ObjectId.isValid(manualImageId)) {
    const doc = await collection.findOne({ ...baseQuery, _id: new ObjectId(manualImageId) }, { projection: imageProjection() });
    if (doc) return serializeDailyImage(doc);
  }

  const total = await collection.countDocuments(baseQuery);
  if (!total) return null;

  const index = hashDateKey(challengeDate) % total;
  const [doc] = await collection
    .find(baseQuery, { projection: imageProjection() })
    .sort({ date: -1, _id: -1 })
    .skip(index)
    .limit(1)
    .toArray();

  return serializeDailyImage(doc);
}

function normalizeReward(raw: any) {
  const dailyReward = raw && typeof raw === 'object' ? raw : {};
  return {
    coins: Number.isFinite(Number(dailyReward.coins)) ? Number(dailyReward.coins) : 0,
    streak: Number.isFinite(Number(dailyReward.streak)) ? Number(dailyReward.streak) : 0,
    lastClaimDate: typeof dailyReward.lastClaimDate === 'string' ? dailyReward.lastClaimDate : null,
    claimedDates: Array.isArray(dailyReward.claimedDates)
      ? dailyReward.claimedDates.filter((x: any) => typeof x === 'string')
      : [],
    unlockedSpecialPacks: Array.isArray(dailyReward.unlockedSpecialPacks)
      ? dailyReward.unlockedSpecialPacks.filter((x: any) => typeof x === 'string')
      : [],
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const challengeDate = todayKey();
    const auth = await verifyFirebaseAuth(request);
    const uid = auth.ok ? auth.uid : null;

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const config = await getGameConfig(db);
    const manualImageId = getManualDailyImageId(config, challengeDate);
    const image = await getDailyImage(db, challengeDate, manualImageId);
    const rewardCoins = config.dailyReward.rewardCoins;
    const streakRewardDays = config.dailyReward.streakRewardDays;
    const specialPack = {
      id: config.dailyReward.specialPackId,
      name: config.dailyReward.specialPackName,
    };

    if (!image) {
      return json({
        challengeDate,
        rewardCoins,
        streakRewardDays,
        specialPack,
        image: null,
        status: null,
        message: 'No public images are available for a daily challenge yet.',
      });
    }

    let status: any = null;
    if (uid) {
      const users = db.collection('users');
      const userDoc = await users.findOne({ _id: uid }, { projection: { dailyReward: 1 } });
      const reward = normalizeReward(userDoc?.dailyReward);
      status = {
        signedIn: true,
        claimedToday: reward.claimedDates.includes(challengeDate) || reward.lastClaimDate === challengeDate,
        coins: reward.coins,
        streak: reward.streak,
        lastClaimDate: reward.lastClaimDate,
        unlockedSpecialPacks: reward.unlockedSpecialPacks,
      };
    } else {
      status = {
        signedIn: false,
        claimedToday: false,
        coins: 0,
        streak: 0,
        lastClaimDate: null,
        unlockedSpecialPacks: [],
      };
    }

    return json({
      challengeDate,
      rewardCoins,
      streakRewardDays,
      specialPack,
      image,
      status,
    });
  } catch (e) {
    return json({ error: 'Failed to load daily challenge', details: getErrorMessage(e) }, 500);
  }
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

  const challengeDate = typeof body?.challengeDate === 'string' ? body.challengeDate : todayKey();
  const currentDate = todayKey();
  const imageId = typeof body?.imageId === 'string' ? body.imageId : '';

  if (challengeDate !== currentDate) {
    return json({ error: 'Only today\'s daily challenge can be claimed.' }, 400);
  }

  if (!ObjectId.isValid(imageId)) {
    return json({ error: 'Invalid image id.' }, 400);
  }

  try {
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const config = await getGameConfig(db);
    const manualImageId = getManualDailyImageId(config, challengeDate);
    const expectedImage = await getDailyImage(db, challengeDate, manualImageId);
    const rewardCoins = config.dailyReward.rewardCoins;
    const streakRewardDays = config.dailyReward.streakRewardDays;
    const specialPack = {
      id: config.dailyReward.specialPackId,
      name: config.dailyReward.specialPackName,
    };

    if (!expectedImage || expectedImage._id !== imageId) {
      return json({ error: 'This image is not today\'s challenge.' }, 400);
    }

    const users = db.collection('users');
    const now = new Date();
    const userDoc = await users.findOne({ _id: auth.uid }, { projection: { dailyReward: 1 } });
    const reward = normalizeReward(userDoc?.dailyReward);

    if (reward.claimedDates.includes(challengeDate) || reward.lastClaimDate === challengeDate) {
      return json({
        success: true,
        alreadyClaimed: true,
        message: 'Daily reward already claimed today.',
        rewardCoins: 0,
        totalCoins: reward.coins,
        streak: reward.streak,
        claimedToday: true,
        unlockedSpecialPack: null,
        specialPack,
      });
    }

    const yesterday = addDaysKey(challengeDate, -1);
    const nextStreak = reward.lastClaimDate === yesterday ? reward.streak + 1 : 1;
    const nextCoins = reward.coins + rewardCoins;
    const claimedDates = Array.from(new Set([...reward.claimedDates.slice(-60), challengeDate]));

    let unlockedSpecialPack: { id: string; name: string } | null = null;
    const unlockedSpecialPacks = [...reward.unlockedSpecialPacks];

    if (nextStreak >= streakRewardDays && !unlockedSpecialPacks.includes(specialPack.id)) {
      unlockedSpecialPacks.push(specialPack.id);
      unlockedSpecialPack = specialPack;
    }

    await users.updateOne(
      { _id: auth.uid },
      {
        $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now },
        $set: {
          updatedAt: now,
          dailyReward: {
            coins: nextCoins,
            streak: nextStreak,
            lastClaimDate: challengeDate,
            claimedDates,
            unlockedSpecialPacks,
          },
        },
      },
      { upsert: true },
    );

    return json({
      success: true,
      alreadyClaimed: false,
      message: unlockedSpecialPack
        ? `Daily reward claimed! You unlocked ${unlockedSpecialPack.name}.`
        : `Daily reward claimed! +${rewardCoins} coins.`,
      rewardCoins,
      totalCoins: nextCoins,
      streak: nextStreak,
      claimedToday: true,
      unlockedSpecialPack,
      specialPack,
    });
  } catch (e) {
    return json({ error: 'Failed to claim daily reward', details: getErrorMessage(e) }, 500);
  }
}
