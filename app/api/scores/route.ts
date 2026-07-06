/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '@/lib/mongo';
import { verifyFirebaseAuth } from '@/lib/auth';
import { ensureLeaderboardIndexes, formatSeconds, getLeaderboard } from '@/lib/leaderboards';

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

function cleanSafeId(value: unknown, fieldName: string, maxLength = 160): string | null {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return null;
  if (cleaned.length > maxLength) throw new Error(`${fieldName} is too long.`);
  if (!/^[A-Za-z0-9:_./-]+$/.test(cleaned)) throw new Error(`${fieldName} contains unsupported characters.`);
  return cleaned;
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

function serializeScore(doc: any) {
  if (!doc) return null;
  return {
    _id: doc._id?.toString?.() ?? String(doc._id ?? ''),
    completionId: typeof doc.completionId === 'string' ? doc.completionId : '',
    imageId: typeof doc.imageId === 'string' ? doc.imageId : '',
    levelId: typeof doc.levelId === 'string' ? doc.levelId : '',
    mode: doc.mode === 'challenge' ? 'challenge' : 'relax',
    timeSeconds: Math.max(0, Math.round(Number(doc.timeSeconds || 0))),
    accuracy: Math.max(0, Math.min(100, Math.round(Number(doc.accuracy || 0) * 100) / 100)),
    mistakes: Math.max(0, Math.floor(Number(doc.mistakes || 0))),
    usedHints: Math.max(0, Math.floor(Number(doc.usedHints || 0))),
    scoreValue: Math.max(0, Math.round(Number(doc.timeSeconds || 0))),
    scoreLabel: formatSeconds(doc.timeSeconds),
    completedAt: toIso(doc.completedAt),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
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
    const completionIdRaw = cleanSafeId(body?.completionId, 'completionId', 80);
    const clientCompletionId = cleanSafeId(body?.clientCompletionId ?? body?.idempotencyKey, 'clientCompletionId', 120);

    if (!completionIdRaw && !clientCompletionId) {
      return json({ error: 'completionId or clientCompletionId is required. Save the completion event first.' }, 400);
    }

    const client = await getMongoClient();
    const db = client.db(getDbName());
    const completions = db.collection<any>('completions');
    const scores = db.collection<any>('scores');
    await ensureLeaderboardIndexes(db);

    let completion: any = null;
    if (completionIdRaw && ObjectId.isValid(completionIdRaw)) {
      completion = await completions.findOne({ _id: new ObjectId(completionIdRaw), userId: auth.uid });
    }
    if (!completion && clientCompletionId) {
      completion = await completions.findOne({ userId: auth.uid, clientCompletionId });
    }

    if (!completion) {
      return json({ error: 'Matching completion was not found. Scores must be linked to a saved completion.' }, 404);
    }

    const now = new Date();
    const completionId = completion._id?.toString?.() ?? String(completion._id);
    const scoreDoc = {
      userId: auth.uid,
      userEmail: auth.email || completion.userEmail || null,
      playerName: auth.name || null,
      completionId,
      clientCompletionId: typeof completion.clientCompletionId === 'string' ? completion.clientCompletionId : clientCompletionId,
      imageId: String(completion.imageId || ''),
      levelId: String(completion.levelId || ''),
      mode: completion.mode === 'challenge' ? 'challenge' : 'relax',
      timeSeconds: Math.max(0, Math.round(Number(completion.timeSeconds || 0))),
      accuracy: Math.max(0, Math.min(100, Math.round(Number(completion.accuracy || 0) * 100) / 100)),
      mistakes: Math.max(0, Math.floor(Number(completion.mistakes || 0))),
      usedHints: Math.max(0, Math.floor(Number(completion.usedHints || 0))),
      isDailyChallenge: Boolean(completion.isDailyChallenge),
      challengeDate: typeof completion.challengeDate === 'string' ? completion.challengeDate : null,
      completedAt: completion.completedAt instanceof Date ? completion.completedAt : new Date(completion.completedAt || now),
      updatedAt: now,
    };

    const existingScore = await scores.findOne({ userId: auth.uid, completionId }, { projection: { _id: 1 } });
    const savedScore = await scores.findOneAndUpdate(
      { userId: auth.uid, completionId },
      {
        $setOnInsert: { createdAt: now },
        $set: scoreDoc,
      },
      { upsert: true, returnDocument: 'after' }
    );

    const [fastest, weeklyCompleted, streak] = await Promise.all([
      getLeaderboard(db, 'fastest', auth.uid, 10),
      getLeaderboard(db, 'weekly_completed', auth.uid, 10),
      getLeaderboard(db, 'streak', auth.uid, 10),
    ]);

    return json({
      success: true,
      duplicate: Boolean(existingScore),
      score: serializeScore(savedScore || { ...scoreDoc, _id: null, createdAt: now }),
      leaderboards: {
        fastest,
        weekly_completed: weeklyCompleted,
        streak,
      },
    });
  } catch (e) {
    const message = getErrorMessage(e);
    const validation = /required|must be|unsupported|too long|not found/i.test(message);
    return json({ error: validation ? message : 'Failed to save score', details: validation ? undefined : message }, validation ? 400 : 500);
  }
}
