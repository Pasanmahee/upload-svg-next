/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { calculateUnlockedLevels, getLevelById, isValidLevelId, normalizeLevelProgress } from '@/lib/levelSystem';
import { getGameConfig } from '@/lib/gameConfig';

export const runtime = 'nodejs';

const MAX_TIME_SECONDS = 24 * 60 * 60;
const MAX_MISTAKES = 100000;
const MAX_USED_HINTS = 10000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let completionIndexesPromise: Promise<void> | null = null;

type CompletionMode = 'relax' | 'challenge';

type CompletionPayload = {
  imageId: string;
  levelId: string;
  mode: CompletionMode;
  timeSeconds: number;
  accuracy: number;
  mistakes: number;
  usedHints: number;
  completedAt: Date;
  isDailyChallenge: boolean;
  challengeDate: string | null;
  clientCompletionId: string | null;
};

function headers(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function parseLimit(value: string | null): number {
  const raw = Number.parseInt(value || String(DEFAULT_HISTORY_LIMIT), 10);
  if (!Number.isFinite(raw)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.max(raw, 1), MAX_HISTORY_LIMIT);
}

function cleanSafeId(value: unknown, fieldName: string, maxLength = 160): string {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) throw new Error(`${fieldName} is required.`);
  if (cleaned.length > maxLength) throw new Error(`${fieldName} is too long.`);

  // Keep IDs safe for logging, analytics grouping, and future query params.
  // Mongo ObjectIds, offline image IDs, and UUID-like client IDs are all allowed.
  if (!/^[A-Za-z0-9:_./-]+$/.test(cleaned)) throw new Error(`${fieldName} contains unsupported characters.`);
  return cleaned;
}

function parseMode(value: unknown): CompletionMode {
  const mode = String(value || 'relax').trim().toLowerCase();
  if (mode === 'relax' || mode === 'challenge') return mode;
  throw new Error('mode must be either relax or challenge.');
}

function parsePositiveSeconds(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('timeSeconds must be a number.');
  const rounded = Math.round(n);
  if (rounded < 0 || rounded > MAX_TIME_SECONDS) throw new Error(`timeSeconds must be between 0 and ${MAX_TIME_SECONDS}.`);
  return rounded;
}

function parseAccuracy(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('accuracy must be a number.');
  if (n < 0 || n > 100) throw new Error('accuracy must be between 0 and 100.');
  return Math.round(n * 100) / 100;
}

function parseNonNegativeInt(value: unknown, fieldName: string, max: number): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error(`${fieldName} must be a number.`);
  const rounded = Math.floor(n);
  if (rounded < 0 || rounded > max) throw new Error(`${fieldName} must be between 0 and ${max}.`);
  return rounded;
}

function parseCompletedAt(value: unknown, now: Date): Date {
  if (value === undefined || value === null || value === '') return now;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error('completedAt must be a valid ISO date/time.');

  // Avoid clearly impossible client clocks while still allowing small clock drift.
  if (parsed.getTime() > now.getTime() + 10 * 60 * 1000) return now;
  return parsed;
}

function parseChallengeDate(value: unknown): string | null {
  const cleaned = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function parseCompletionPayload(body: any, validLevelIds: string[]): CompletionPayload {
  const now = new Date();
  const imageId = cleanSafeId(body?.imageId, 'imageId');
  const levelId = String(body?.levelId || '').trim();
  if (!validLevelIds.includes(levelId)) throw new Error('Invalid levelId.');

  const clientCompletionIdRaw = body?.clientCompletionId ?? body?.idempotencyKey ?? null;
  const clientCompletionId = clientCompletionIdRaw ? cleanSafeId(clientCompletionIdRaw, 'clientCompletionId', 120) : null;

  return {
    imageId,
    levelId,
    mode: parseMode(body?.mode),
    timeSeconds: parsePositiveSeconds(body?.timeSeconds),
    accuracy: parseAccuracy(body?.accuracy),
    mistakes: parseNonNegativeInt(body?.mistakes, 'mistakes', MAX_MISTAKES),
    usedHints: parseNonNegativeInt(body?.usedHints, 'usedHints', MAX_USED_HINTS),
    completedAt: parseCompletedAt(body?.completedAt, now),
    isDailyChallenge: Boolean(body?.isDailyChallenge),
    challengeDate: parseChallengeDate(body?.challengeDate),
    clientCompletionId,
  };
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

function serializeCompletion(doc: any) {
  if (!doc) return null;
  return {
    _id: doc._id?.toString?.() ?? String(doc._id ?? ''),
    userId: typeof doc.userId === 'string' ? doc.userId : '',
    imageId: typeof doc.imageId === 'string' ? doc.imageId : '',
    levelId: typeof doc.levelId === 'string' ? doc.levelId : '',
    mode: doc.mode === 'challenge' ? 'challenge' : 'relax',
    timeSeconds: Number.isFinite(Number(doc.timeSeconds)) ? Number(doc.timeSeconds) : 0,
    accuracy: Number.isFinite(Number(doc.accuracy)) ? Number(doc.accuracy) : 0,
    mistakes: Number.isFinite(Number(doc.mistakes)) ? Number(doc.mistakes) : 0,
    usedHints: Number.isFinite(Number(doc.usedHints)) ? Number(doc.usedHints) : 0,
    completedAt: toIso(doc.completedAt),
    isDailyChallenge: Boolean(doc.isDailyChallenge),
    challengeDate: typeof doc.challengeDate === 'string' ? doc.challengeDate : null,
    clientCompletionId: typeof doc.clientCompletionId === 'string' ? doc.clientCompletionId : null,
    createdAt: toIso(doc.createdAt),
  };
}

function countUniqueImagesByLevel(completedImagesByLevel: Record<string, string[]>): number {
  const all = new Set<string>();
  for (const values of Object.values(completedImagesByLevel || {})) {
    for (const id of Array.isArray(values) ? values : []) all.add(String(id));
  }
  return all.size;
}

function safeStatsImageKey(imageId: string): string {
  return imageId.replace(/\./g, '_');
}

function isBetterCompletion(candidate: any, current: any): boolean {
  if (!current) return true;
  const candidateAccuracy = Number(candidate?.accuracy ?? 0);
  const currentAccuracy = Number(current?.accuracy ?? 0);
  if (candidateAccuracy !== currentAccuracy) return candidateAccuracy > currentAccuracy;

  const candidateTime = Number(candidate?.timeSeconds ?? Number.MAX_SAFE_INTEGER);
  const currentTime = Number(current?.timeSeconds ?? Number.MAX_SAFE_INTEGER);
  if (candidateTime !== currentTime) return candidateTime < currentTime;

  const candidateMistakes = Number(candidate?.mistakes ?? Number.MAX_SAFE_INTEGER);
  const currentMistakes = Number(current?.mistakes ?? Number.MAX_SAFE_INTEGER);
  if (candidateMistakes !== currentMistakes) return candidateMistakes < currentMistakes;

  const candidateHints = Number(candidate?.usedHints ?? Number.MAX_SAFE_INTEGER);
  const currentHints = Number(current?.usedHints ?? Number.MAX_SAFE_INTEGER);
  return candidateHints < currentHints;
}

async function ensureCompletionIndexes(completions: any) {
  if (!completionIndexesPromise) {
    completionIndexesPromise = Promise.all([
      completions.createIndex({ userId: 1, completedAt: -1 }),
      completions.createIndex({ userId: 1, imageId: 1, completedAt: -1 }),
      completions.createIndex({ levelId: 1, completedAt: -1 }),
      completions.createIndex({ mode: 1, completedAt: -1 }),
      completions.createIndex({ isDailyChallenge: 1, completedAt: -1 }),
      completions.createIndex(
        { userId: 1, clientCompletionId: 1 },
        {
          unique: true,
          partialFilterExpression: { clientCompletionId: { $type: 'string' } },
        }
      ),
    ]).then(() => undefined).catch(() => undefined);
  }
  await completionIndexesPromise;
}

export async function GET(request: Request) {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'));
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const completions = db.collection<any>('completions');
    const users = db.collection<any>('users');
    const now = new Date();
    const weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);

    await ensureCompletionIndexes(completions);

    const [userDoc, totalCompletions, weeklyCompletions, recent] = await Promise.all([
      users.findOne({ _id: auth.uid }, { projection: { completionStats: 1, levelProgress: 1 } }),
      completions.countDocuments({ userId: auth.uid }),
      completions.countDocuments({ userId: auth.uid, completedAt: { $gte: weekStart } }),
      completions.find({ userId: auth.uid }).sort({ completedAt: -1, _id: -1 }).limit(limit).toArray(),
    ]);

    const config = await getGameConfig(db);
    const levelProgress = normalizeLevelProgress(userDoc?.levelProgress, config.levels);

    return json({
      success: true,
      stats: {
        totalCompletions,
        weeklyCompletions,
        uniqueImagesCompleted: countUniqueImagesByLevel(levelProgress.completedImagesByLevel),
        lastCompletedAt: toIso(userDoc?.completionStats?.lastCompletedAt),
      },
      progress: {
        signedIn: !auth.isAnonymous,
        isAnonymous: !!auth.isAnonymous,
        ...levelProgress,
      },
      recent: recent.map(serializeCompletion),
    });
  } catch (e) {
    return json({ error: 'Failed to load completions', details: getErrorMessage(e) }, 500);
  }
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
    const client = await getMongoClient();
    const db = client.db(getDbName());
    const config = await getGameConfig(db);
    const validLevelIds = config.levels.map((level: any) => level.id).filter((id: any) => typeof id === 'string');
    const payload = parseCompletionPayload(body, validLevelIds);

    if (!isValidLevelId(payload.levelId, config.levels)) return json({ error: 'Invalid levelId.' }, 400);

    const users = db.collection<any>('users');
    const completions = db.collection<any>('completions');
    const now = new Date();

    await ensureCompletionIndexes(completions);

    const existingForClientId = payload.clientCompletionId
      ? await completions.findOne({ userId: auth.uid, clientCompletionId: payload.clientCompletionId })
      : null;

    if (existingForClientId) {
      const userDoc = await users.findOne({ _id: auth.uid }, { projection: { completionStats: 1, levelProgress: 1 } });
      const levelProgress = normalizeLevelProgress(userDoc?.levelProgress, config.levels);
      const totalCompletions = await completions.countDocuments({ userId: auth.uid });
      const weeklyCompletions = await completions.countDocuments({ userId: auth.uid, completedAt: { $gte: new Date(now.getTime() - SEVEN_DAYS_MS) } });

      return json({
        success: true,
        duplicate: true,
        completion: serializeCompletion(existingForClientId),
        stats: {
          totalCompletions,
          weeklyCompletions,
          uniqueImagesCompleted: countUniqueImagesByLevel(levelProgress.completedImagesByLevel),
          ratingPromptCandidate: countUniqueImagesByLevel(levelProgress.completedImagesByLevel) === 3,
        },
        progress: {
          signedIn: !auth.isAnonymous,
          isAnonymous: !!auth.isAnonymous,
          ...levelProgress,
        },
      });
    }

    const imageObjectId = ObjectId.isValid(payload.imageId) ? new ObjectId(payload.imageId) : null;
    const completionDoc = {
      userId: auth.uid,
      userEmail: auth.email,
      imageId: payload.imageId,
      imageObjectId,
      levelId: payload.levelId,
      mode: payload.mode,
      timeSeconds: payload.timeSeconds,
      accuracy: payload.accuracy,
      mistakes: payload.mistakes,
      usedHints: payload.usedHints,
      completedAt: payload.completedAt,
      isDailyChallenge: payload.isDailyChallenge,
      challengeDate: payload.challengeDate,
      clientCompletionId: payload.clientCompletionId,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await completions.insertOne(completionDoc);
    const insertedCompletion = { _id: insertResult.insertedId, ...completionDoc };

    const userDoc = await users.findOne({ _id: auth.uid }, { projection: { levelProgress: 1, completionStats: 1 } });
    const beforeProgress = normalizeLevelProgress(userDoc?.levelProgress, config.levels);
    const beforeUnlocked = new Set(beforeProgress.unlockedLevelIds || ['beginner']);
    const byLevel = { ...(beforeProgress.completedImagesByLevel || {}) };
    const currentLevelImages = Array.isArray(byLevel[payload.levelId]) ? byLevel[payload.levelId] : [];
    byLevel[payload.levelId] = Array.from(new Set([...currentLevelImages, payload.imageId]));

    const levelProgress = calculateUnlockedLevels({
      completedImagesByLevel: byLevel,
      unlockedLevelIds: beforeProgress.unlockedLevelIds,
      lastCompletedLevelId: payload.levelId,
    }, config.levels);

    const newlyUnlockedId = (levelProgress.unlockedLevelIds || []).find((id: string) => !beforeUnlocked.has(id));
    const unlockedLevel = newlyUnlockedId ? getLevelById(newlyUnlockedId, config.levels) : null;
    const uniqueImagesCompleted = countUniqueImagesByLevel(levelProgress.completedImagesByLevel);
    const previousStats = userDoc?.completionStats && typeof userDoc.completionStats === 'object' ? userDoc.completionStats : {};
    const bestImageKey = safeStatsImageKey(payload.imageId);
    const previousBestForImage = previousStats.bestByImage && typeof previousStats.bestByImage === 'object'
      ? previousStats.bestByImage[bestImageKey]
      : null;
    const bestForImage = isBetterCompletion(insertedCompletion, previousBestForImage)
      ? {
          imageId: payload.imageId,
          levelId: payload.levelId,
          mode: payload.mode,
          timeSeconds: payload.timeSeconds,
          accuracy: payload.accuracy,
          mistakes: payload.mistakes,
          usedHints: payload.usedHints,
          completedAt: payload.completedAt,
          completionId: insertResult.insertedId.toString(),
        }
      : previousBestForImage;

    const totalCompletions = Math.max(0, Number(previousStats.totalCompletions || 0)) + 1;
    const dailyChallengeCompletions = Math.max(0, Number(previousStats.dailyChallengeCompletions || 0)) + (payload.isDailyChallenge ? 1 : 0);

    await users.updateOne(
      { _id: auth.uid },
      {
        $setOnInsert: { _id: auth.uid, uid: auth.uid, createdAt: now },
        $set: {
          updatedAt: now,
          levelProgress,
          completionStats: {
            ...previousStats,
            totalCompletions,
            dailyChallengeCompletions,
            uniqueImagesCompleted,
            lastCompletedAt: payload.completedAt,
            lastCompletionId: insertResult.insertedId.toString(),
          },
        },
      },
      { upsert: true }
    );

    // MongoDB cannot store a dotted path inside a nested object literal above for
    // arbitrary image IDs. Set the specific best path separately after the main
    // stats object has been persisted.
    await users.updateOne(
      { _id: auth.uid },
      {
        $set: {
          [`completionStats.bestByImage.${bestImageKey}`]: bestForImage,
        },
      }
    );

    const weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);
    const weeklyCompletions = await completions.countDocuments({ userId: auth.uid, completedAt: { $gte: weekStart } });

    return json({
      success: true,
      completion: serializeCompletion(insertedCompletion),
      stats: {
        totalCompletions,
        weeklyCompletions,
        dailyChallengeCompletions,
        uniqueImagesCompleted,
        ratingPromptCandidate: uniqueImagesCompleted === 3,
        bestForImage,
      },
      progress: {
        signedIn: !auth.isAnonymous,
        isAnonymous: !!auth.isAnonymous,
        ...levelProgress,
      },
      unlockedLevel,
      levels: config.levels,
    });
  } catch (e) {
    const message = getErrorMessage(e);
    const validation = /required|must be|Invalid|unsupported|too long|between/i.test(message);
    return json({ error: validation ? message : 'Failed to save completion', details: validation ? undefined : message }, validation ? 400 : 500);
  }
}
