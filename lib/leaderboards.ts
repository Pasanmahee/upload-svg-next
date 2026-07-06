/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Db } from 'mongodb';

export type LeaderboardType = 'fastest' | 'weekly_completed' | 'streak';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let leaderboardIndexesPromise: Promise<void> | null = null;

export function parseLeaderboardType(value: unknown): LeaderboardType {
  const type = String(value || 'fastest').trim().toLowerCase();
  if (type === 'fastest' || type === 'weekly_completed' || type === 'streak') return type;
  return 'fastest';
}

export function parseLeaderboardLimit(value: unknown): number {
  const raw = Number.parseInt(String(value || DEFAULT_LIMIT), 10);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(Math.max(raw, 1), MAX_LIMIT);
}

export function toIso(v: any): string | null {
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

function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 32);
}

function maskEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  const [name] = email.split('@');
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 16);
  if (!cleaned) return null;
  if (cleaned.length <= 3) return `${cleaned[0] || 'P'}***`;
  return `${cleaned.slice(0, 2)}***${cleaned.slice(-1)}`;
}

export function playerLabel(doc: any): string {
  const explicit = cleanDisplayName(doc?.playerName || doc?.displayName || doc?.name);
  if (explicit) return explicit;

  const fromEmail = maskEmail(doc?.userEmail || doc?.email);
  if (fromEmail) return fromEmail;

  const uid = String(doc?.userId || doc?._id || '').replace(/[^A-Za-z0-9]/g, '');
  const suffix = uid ? uid.slice(-4).toUpperCase().padStart(4, '0') : '0000';
  return `Player ${suffix}`;
}

export function formatSeconds(totalSeconds: unknown): string {
  const safe = Math.max(0, Math.round(Number(totalSeconds || 0)));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export async function ensureLeaderboardIndexes(db: Db) {
  if (!leaderboardIndexesPromise) {
    leaderboardIndexesPromise = Promise.all([
      db.collection<any>('scores').createIndex({ userId: 1, completionId: 1 }, { unique: true, partialFilterExpression: { completionId: { $type: 'string' } } }),
      db.collection<any>('scores').createIndex({ timeSeconds: 1, accuracy: -1, mistakes: 1, usedHints: 1, completedAt: 1 }),
      db.collection<any>('scores').createIndex({ userId: 1, createdAt: -1 }),
      db.collection<any>('completions').createIndex({ userId: 1, completedAt: -1 }),
      db.collection<any>('completions').createIndex({ completedAt: -1 }),
      db.collection<any>('completions').createIndex({ timeSeconds: 1, accuracy: -1, mistakes: 1, usedHints: 1, completedAt: 1 }),
      db.collection<any>('users').createIndex({ 'dailyReward.streak': -1, 'dailyReward.lastClaimDate': -1 }),
    ]).then(() => undefined).catch(() => undefined);
  }
  await leaderboardIndexesPromise;
}

function fastestEntry(doc: any, index: number, currentUid: string | null) {
  return {
    rank: index + 1,
    type: 'fastest' as LeaderboardType,
    playerName: playerLabel(doc),
    isCurrentUser: !!currentUid && doc.userId === currentUid,
    imageId: typeof doc.imageId === 'string' ? doc.imageId : '',
    levelId: typeof doc.levelId === 'string' ? doc.levelId : '',
    mode: doc.mode === 'challenge' ? 'challenge' : 'relax',
    timeSeconds: Math.max(0, Math.round(Number(doc.timeSeconds || 0))),
    accuracy: Math.max(0, Math.min(100, Math.round(Number(doc.accuracy || 0) * 100) / 100)),
    mistakes: Math.max(0, Math.floor(Number(doc.mistakes || 0))),
    usedHints: Math.max(0, Math.floor(Number(doc.usedHints || 0))),
    scoreValue: Math.max(0, Math.round(Number(doc.timeSeconds || 0))),
    scoreLabel: formatSeconds(doc.timeSeconds),
    completedAt: toIso(doc.completedAt || doc.createdAt),
  };
}

function weeklyEntry(doc: any, index: number, currentUid: string | null) {
  return {
    rank: index + 1,
    type: 'weekly_completed' as LeaderboardType,
    playerName: playerLabel({ userId: doc._id || doc.userId, userEmail: doc.userEmail, playerName: doc.playerName }),
    isCurrentUser: !!currentUid && (doc._id === currentUid || doc.userId === currentUid),
    completions: Math.max(0, Math.floor(Number(doc.completions || doc.count || 0))),
    scoreValue: Math.max(0, Math.floor(Number(doc.completions || doc.count || 0))),
    scoreLabel: `${Math.max(0, Math.floor(Number(doc.completions || doc.count || 0)))} completed`,
    lastCompletedAt: toIso(doc.lastCompletedAt),
  };
}

function streakEntry(doc: any, index: number, currentUid: string | null) {
  const reward = doc?.dailyReward && typeof doc.dailyReward === 'object' ? doc.dailyReward : {};
  const streak = Math.max(0, Math.floor(Number(reward.streak || doc.streak || 0)));
  return {
    rank: index + 1,
    type: 'streak' as LeaderboardType,
    playerName: playerLabel({ userId: doc._id || doc.userId, userEmail: doc.email, playerName: doc.playerName }),
    isCurrentUser: !!currentUid && (doc._id === currentUid || doc.userId === currentUid),
    streak,
    scoreValue: streak,
    scoreLabel: `${streak} day${streak === 1 ? '' : 's'}`,
    lastClaimDate: typeof reward.lastClaimDate === 'string' ? reward.lastClaimDate : null,
  };
}

export async function getFastestLeaderboard(db: Db, currentUid: string | null, limit: number) {
  await ensureLeaderboardIndexes(db);
  const scores = db.collection<any>('scores');
  const completions = db.collection<any>('completions');
  const sort = { timeSeconds: 1, accuracy: -1, mistakes: 1, usedHints: 1, completedAt: 1, createdAt: 1 } as any;

  let rows = await scores.aggregate([
    { $match: { timeSeconds: { $gte: 0 } } },
    { $sort: sort },
    { $group: { _id: '$userId', best: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$best' } },
    { $sort: sort },
    { $limit: limit },
  ]).toArray();

  // Fallback/backfill: old completion records from before /api/scores was added
  // should still be eligible for the fastest leaderboard.
  if (rows.length === 0) {
    rows = await completions.aggregate([
      { $match: { timeSeconds: { $gte: 0 } } },
      { $sort: sort },
      { $group: { _id: '$userId', best: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$best' } },
      { $sort: sort },
      { $limit: limit },
    ]).toArray();
  }

  return rows.map((doc: any, index: number) => fastestEntry(doc, index, currentUid));
}

export async function getWeeklyCompletedLeaderboard(db: Db, currentUid: string | null, limit: number, now = new Date()) {
  await ensureLeaderboardIndexes(db);
  const completions = db.collection<any>('completions');
  const weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);

  const rows = await completions.aggregate([
    { $match: { completedAt: { $gte: weekStart } } },
    {
      $group: {
        _id: '$userId',
        completions: { $sum: 1 },
        lastCompletedAt: { $max: '$completedAt' },
        userEmail: { $first: '$userEmail' },
        playerName: { $first: '$playerName' },
      },
    },
    { $sort: { completions: -1, lastCompletedAt: -1 } },
    { $limit: limit },
  ]).toArray();

  return rows.map((doc: any, index: number) => weeklyEntry(doc, index, currentUid));
}

export async function getStreakLeaderboard(db: Db, currentUid: string | null, limit: number) {
  await ensureLeaderboardIndexes(db);
  const users = db.collection<any>('users');
  const rows = await users
    .find({ 'dailyReward.streak': { $gt: 0 } }, { projection: { uid: 1, dailyReward: 1, email: 1, playerName: 1 } })
    .sort({ 'dailyReward.streak': -1, 'dailyReward.lastClaimDate': -1, updatedAt: -1 })
    .limit(limit)
    .toArray();

  return rows.map((doc: any, index: number) => streakEntry(doc, index, currentUid));
}

export async function getLeaderboard(db: Db, type: LeaderboardType, currentUid: string | null, limit: number) {
  if (type === 'weekly_completed') return getWeeklyCompletedLeaderboard(db, currentUid, limit);
  if (type === 'streak') return getStreakLeaderboard(db, currentUid, limit);
  return getFastestLeaderboard(db, currentUid, limit);
}
